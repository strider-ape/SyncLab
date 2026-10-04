import { gitBlobId } from '../core/blobHash';
import { isHardExcluded } from '../core/paths';
import { buildPlan, computeChanges, countDeletions } from '../core/planner';
import type { Attention, BlobId, Change, PullItem, PushItem, RepoPath, Resolution } from '../core/types';
import { GitLabError, type CommitAction } from '../gitlab/GitLabClient';
import { toBase64 } from './base64';
import { buildCommitMessage } from './commitMessage';
import type { LocalFs, RemoteRepo, StatePersistence, StoredState } from './ports';
import { Store } from './store';

export interface EngineConfig {
	remote: RemoteRepo;
	local: LocalFs;
	state: StatePersistence;
	/** Identifies GitLab host + project + branch + folder. Changing any of them starts a fresh history. */
	targetKey: string;
	deviceId: string;
	/** Shown in commit messages. */
	deviceName: string;
	isIgnored: (path: RepoPath) => boolean;
	maxFileBytes: number;
	now?: () => Date;
}

export type LogKind = 'info' | 'up' | 'down' | 'ok' | 'warn' | 'error';
export interface LogEntry { id: number; at: number; kind: LogKind; text: string }

export interface EngineState {
	configured: boolean;
	phase: 'idle' | 'checking' | 'syncing';
	changes: Change[];
	attention: Attention[];
	tooLarge: RepoPath[];
	/** No usable sync history: nothing will be deleted and differing files are conflicts. */
	firstSync: boolean;
	checkedAt?: number;
	lastSyncAt?: number;
	error?: string;
	/** GitLab error kind behind `error`, e.g. 'unauthorized' when the token was rejected. */
	errorKind?: string;
	progress?: { done: number; total: number };
	log: LogEntry[];
}

export interface SyncRequest {
	message?: string;
	excluded?: ReadonlySet<RepoPath>;
	resolutions?: ReadonlyMap<RepoPath, Resolution>;
	/** Asked when a sync would delete many files. Resolve true to go ahead. */
	confirmDeletions?: (deletions: number, tracked: number) => Promise<boolean>;
}

export interface SyncSummary {
	pulled: number;
	pushed: number;
	deleted: number;
	skipped: number;
	failed: number;
	conflicts: number;
	commitId?: string;
	cancelled?: boolean;
	error?: string;
}

/** GitLab no longer matches what the plan was built from; the plan must be rebuilt. */
class RemoteMovedError extends Error {
	constructor(message: string, readonly original?: unknown) {
		super(message);
	}
}

interface Gathered {
	head: string | null;
	/** Full stored base, including paths currently out of scope. Updated and saved as the sync progresses. */
	files: Map<RepoPath, BlobId>;
	base: Map<RepoPath, BlobId>;
	local: Map<RepoPath, BlobId>;
	remote: Map<RepoPath, BlobId>;
	tooLarge: RepoPath[];
	firstSync: boolean;
}

type Download = { bytes: ArrayBuffer } | { error: unknown };

interface PreparedAction {
	action: CommitAction;
	kind: 'add' | 'update' | 'delete' | 'move';
	size: number;
	/** Base updates once the commit lands: path → blob, or null when removed. */
	effects: Array<[RepoPath, BlobId | null]>;
	label: string;
}

const MAX_ATTEMPTS = 3;
const MAX_COMMIT_BYTES = 15 * 1024 * 1024;
const HASH_CONCURRENCY = 8;
const PULL_CONCURRENCY = 6;
const LOG_LIMIT = 200;

function initialState(): EngineState {
	return { configured: false, phase: 'idle', changes: [], attention: [], tooLarge: [], firstSync: false, log: [] };
}

export class SyncEngine {
	readonly state = new Store<EngineState>(initialState());

	private config: EngineConfig | null = null;
	private running = false;
	private queue: Promise<void> = Promise.resolve();
	private treeCache: { head: string | null; tree: Map<RepoPath, BlobId> } | null = null;
	private readonly hashCache = new Map<RepoPath, { size: number; mtime: number; blob: BlobId }>();
	private stored: StoredState | null | undefined;
	private logId = 0;

	configure(config: EngineConfig | null): void {
		this.config = config;
		this.treeCache = null;
		this.hashCache.clear();
		this.stored = undefined;
		this.state.update(s => ({ ...initialState(), configured: config !== null, log: s.log }));
	}

	get isRunning(): boolean {
		return this.running;
	}

	/** Re-reads GitLab and the vault and recomputes the change list. */
	refresh(): Promise<void> {
		return this.enqueueCheck(true);
	}

	/** Recomputes the change list from the vault only, reusing the last GitLab snapshot. */
	refreshLocal(): Promise<void> {
		return this.enqueueCheck(false);
	}

	/** Current bytes on both sides of a path, for the diff view. */
	async contents(change: Change): Promise<{ local: ArrayBuffer | null; remote: ArrayBuffer | null }> {
		const config = this.requireConfig();
		const [local, remote] = await Promise.all([
			config.local.read(change.path),
			change.remote ? config.remote.blob(change.remote) : Promise.resolve(null),
		]);
		return { local, remote };
	}

	async sync(request: SyncRequest = {}): Promise<SyncSummary> {
		const config = this.requireConfig();
		if (this.running) throw new Error('A sync is already running.');
		this.running = true;
		const summary: SyncSummary = { pulled: 0, pushed: 0, deleted: 0, skipped: 0, failed: 0, conflicts: 0 };

		try {
			await this.queue;
			this.patch({ phase: 'syncing', error: undefined, errorKind: undefined, progress: { done: 0, total: 0 } });
			this.log('info', 'Checking GitLab…');
			let approvedDeletions = 0;

			for (let attempt = 1; ; attempt++) {
				const g = await this.gather(config, true);
				const set = computeChanges(g.base, g.local, g.remote);
				const plan = buildPlan(set, { excluded: request.excluded, resolutions: request.resolutions, now: config.now?.() });

				const deletions = countDeletions(plan);
				if (deletions > approvedDeletions && needsDeleteConfirmation(deletions, g.base.size)) {
					const approved = request.confirmDeletions ? await request.confirmDeletions(deletions, g.base.size) : false;
					if (!approved) {
						summary.cancelled = true;
						this.log('warn', 'Sync cancelled. Nothing was changed.');
						return summary;
					}
					approvedDeletions = deletions;
				}

				for (const entry of plan.inSync) {
					if (entry.blob === undefined) g.files.delete(entry.path);
					else g.files.set(entry.path, entry.blob);
				}
				this.patch({ progress: { done: 0, total: plan.pull.length + plan.push.length } });

				await this.applyPulls(config, plan.pull, g.files, summary);
				await this.save(config, g.files, g.head);

				try {
					const commitId = await this.applyPushes(config, plan.push, g, summary, request.message);
					if (commitId) summary.commitId = commitId;
				} catch (error) {
					if (error instanceof RemoteMovedError) {
						if (attempt < MAX_ATTEMPTS) {
							this.log('warn', 'GitLab changed during the sync. Checking again…');
							continue;
						}
						throw error.original instanceof Error ? error.original : new Error('GitLab kept changing during the sync. Try again in a moment.');
					}
					throw error;
				}

				summary.conflicts = plan.conflicts.length;
				summary.skipped += plan.skipped.length;
				const at = Date.now();
				await this.save(config, g.files, summary.commitId ?? g.head, undefined, at);
				this.patch({ lastSyncAt: at });
				this.log(summary.failed ? 'warn' : 'ok', describeSummary(summary));
				return summary;
			}
		} catch (error) {
			summary.error = describeError(error);
			this.log('error', summary.error);
			this.patch({ error: summary.error, errorKind: errorKindOf(error) });
			return summary;
		} finally {
			this.running = false;
			this.patch({ phase: 'idle', progress: undefined });
			void this.refresh();
		}
	}

	private enqueueCheck(network: boolean): Promise<void> {
		const config = this.config;
		if (!config || this.running) return Promise.resolve();
		this.queue = this.queue.then(() => this.check(config, network)).catch(() => undefined);
		return this.queue;
	}

	private async check(config: EngineConfig, network: boolean): Promise<void> {
		if (config !== this.config || this.running) return;
		this.patch({ phase: 'checking' });
		try {
			const g = await this.gather(config, network);
			if (config !== this.config) return;
			const set = computeChanges(g.base, g.local, g.remote);
			this.patch({
				changes: set.changes,
				attention: set.attention,
				tooLarge: g.tooLarge,
				firstSync: g.firstSync,
				checkedAt: Date.now(),
				lastSyncAt: this.stored?.lastSyncAt,
				error: undefined,
				errorKind: undefined,
			});
		} catch (error) {
			if (config === this.config) this.patch({ error: describeError(error), errorKind: errorKindOf(error) });
		} finally {
			if (!this.running) this.patch({ phase: 'idle' });
		}
	}

	private async gather(config: EngineConfig, network: boolean): Promise<Gathered> {
		const stored = await this.loadStored(config);

		let head: string | null;
		let rawRemote: Map<RepoPath, BlobId>;
		if (network || !this.treeCache) {
			head = await config.remote.head();
			if (head !== null && this.treeCache?.head === head) {
				rawRemote = this.treeCache.tree;
			} else {
				rawRemote = head === null ? new Map<RepoPath, BlobId>() : await config.remote.tree(head);
				this.treeCache = { head, tree: rawRemote };
			}
		} else {
			head = this.treeCache.head;
			rawRemote = this.treeCache.tree;
		}

		const valid = stored !== null && stored.targetKey === config.targetKey && stored.deviceId === config.deviceId;
		const files = new Map<RepoPath, BlobId>(valid ? Object.entries(stored.files) : []);
		if (valid && stored.pending) {
			// A commit was in flight when SyncLab last stopped. If it landed, adopt it as the base.
			for (const [path, blob] of Object.entries(stored.pending)) {
				const remoteBlob = rawRemote.get(path);
				if (blob === null && remoteBlob === undefined) files.delete(path);
				else if (blob !== null && remoteBlob === blob) files.set(path, blob);
			}
		}

		const { local, tooLarge } = await this.localTree(config);
		const tooLargeSet = new Set(tooLarge);
		// Out-of-scope paths are removed from all three sides, so ignoring or
		// skipping a file can never look like a deletion.
		const inScope = (path: RepoPath) => !isHardExcluded(path) && !config.isIgnored(path) && !tooLargeSet.has(path);

		return {
			head,
			files,
			base: filterMap(files, inScope),
			local,
			remote: filterMap(rawRemote, inScope),
			tooLarge,
			firstSync: !valid,
		};
	}

	private async localTree(config: EngineConfig): Promise<{ local: Map<RepoPath, BlobId>; tooLarge: RepoPath[] }> {
		const entries = await config.local.list();
		const local = new Map<RepoPath, BlobId>();
		const tooLarge: RepoPath[] = [];
		const toHash: typeof entries = [];
		const seen = new Set<RepoPath>();

		for (const entry of entries) {
			if (isHardExcluded(entry.path) || config.isIgnored(entry.path)) continue;
			seen.add(entry.path);
			if (entry.size > config.maxFileBytes) {
				tooLarge.push(entry.path);
				continue;
			}
			const cached = this.hashCache.get(entry.path);
			if (cached && cached.size === entry.size && cached.mtime === entry.mtime) local.set(entry.path, cached.blob);
			else toHash.push(entry);
		}

		await forEachLimit(toHash, HASH_CONCURRENCY, async entry => {
			const bytes = await config.local.read(entry.path);
			if (!bytes) return;
			const blob = await gitBlobId(bytes);
			this.hashCache.set(entry.path, { size: entry.size, mtime: entry.mtime, blob });
			local.set(entry.path, blob);
		});

		for (const path of this.hashCache.keys()) if (!seen.has(path)) this.hashCache.delete(path);
		return { local, tooLarge: tooLarge.sort() };
	}

	private async applyPulls(config: EngineConfig, items: PullItem[], files: Map<RepoPath, BlobId>, summary: SyncSummary): Promise<void> {
		// Downloads run a few at a time (a first sync on a new device can be
		// hundreds of files), but writes stay one at a time and each re-checks
		// the vault right before it happens. Small batches keep memory bounded.
		for (let start = 0; start < items.length; start += PULL_CONCURRENCY) {
			const batch = items.slice(start, start + PULL_CONCURRENCY);
			const downloads = await Promise.all(batch.map(item => (item.op === 'delete'
				? Promise.resolve(null)
				: config.remote.blob(item.remoteBlob as BlobId).then(
					(bytes): Download => ({ bytes }),
					(error: unknown): Download => ({ error }),
				))));
			for (const [index, item] of batch.entries()) {
				await this.applyPull(config, item, downloads[index] ?? null, files, summary);
				this.step();
			}
		}
	}

	private async applyPull(config: EngineConfig, item: PullItem, download: Download | null, files: Map<RepoPath, BlobId>, summary: SyncSummary): Promise<void> {
		try {
			const current = await this.localBlob(config, item.path);
			if (current !== item.localBlob) {
				summary.skipped++;
				this.log('warn', `${item.path} changed while syncing. It'll be picked up next time.`);
			} else if (item.op === 'delete') {
				await config.local.trash(item.path);
				files.delete(item.path);
				summary.deleted++;
				this.log('down', `Moved ${item.path} to trash (deleted on GitLab)`);
			} else {
				if (!download) throw new Error('nothing was downloaded');
				if ('error' in download) throw download.error;
				const expected = item.remoteBlob as BlobId;
				if ((await gitBlobId(download.bytes)) !== expected) throw new Error('the download was incomplete or damaged');
				if (item.backupLocal && current !== undefined) await config.local.trash(item.path);
				await config.local.write(item.path, download.bytes);
				files.set(item.path, expected);
				summary.pulled++;
				this.log('down', `${item.backupLocal ? 'Took GitLab\'s version of' : 'Pulled'} ${item.path}`);
			}
		} catch (error) {
			summary.failed++;
			this.log('error', `Couldn't pull ${item.path}: ${describeError(error)}`);
		}
	}

	private async applyPushes(config: EngineConfig, items: PushItem[], g: Gathered, summary: SyncSummary, message?: string): Promise<string | undefined> {
		if (items.length === 0) return undefined;

		const prepared: Array<{ item: PushItem; blob: BlobId | null; content?: string; lastCommitId?: string }> = [];
		for (const item of items) {
			let blob: BlobId | null = null;
			let content: string | undefined;
			if (item.op !== 'delete') {
				const bytes = await config.local.read(item.path);
				if (!bytes) {
					summary.skipped++;
					this.log('warn', `${item.path} disappeared before upload. Skipped.`);
					this.step();
					continue;
				}
				blob = await gitBlobId(bytes);
				content = toBase64(bytes);
			}
			let lastCommitId: string | undefined;
			if (item.op !== 'create') {
				// Lock the file to the version we reviewed: GitLab rejects the
				// commit if anyone changed it after this point.
				const info = g.head ? await config.remote.fileInfo(item.path, g.head) : null;
				if (!info || info.blobId !== item.remoteBlob) throw new RemoteMovedError(`${item.path} changed on GitLab`);
				lastCommitId = info.lastCommitId;
			}
			prepared.push({ item, blob, content, lastCommitId });
		}

		const actions = toActions(prepared);
		const chunks = chunkBySize(actions, MAX_COMMIT_BYTES);
		let lastCommit: string | undefined;

		for (const [index, chunk] of chunks.entries()) {
			const pending = Object.fromEntries(chunk.flatMap(a => a.effects));
			await this.save(config, g.files, lastCommit ?? g.head, pending);

			let result: { id: string };
			try {
				const actions = chunk.map(a => a.action);
				result = await config.remote.commit(buildCommitMessage(actions, { message, deviceName: config.deviceName, part: { index, count: chunks.length } }), actions);
			} catch (error) {
				if (error instanceof GitLabError && (error.kind === 'rejected' || error.kind === 'network')) {
					throw new RemoteMovedError(error.message, error);
				}
				throw error;
			}

			for (const action of chunk) {
				for (const [path, blob] of action.effects) {
					if (blob === null) g.files.delete(path);
					else g.files.set(path, blob);
				}
				if (action.kind === 'delete') summary.deleted++;
				else summary.pushed++;
				this.log('up', action.label);
				this.step();
			}
			lastCommit = result.id;
			await this.save(config, g.files, lastCommit);
		}
		return lastCommit;
	}

	private async localBlob(config: EngineConfig, path: RepoPath): Promise<BlobId | undefined> {
		const bytes = await config.local.read(path);
		return bytes ? gitBlobId(bytes) : undefined;
	}

	private async loadStored(config: EngineConfig): Promise<StoredState | null> {
		if (this.stored === undefined) this.stored = await config.state.load();
		return this.stored;
	}

	private async save(config: EngineConfig, files: Map<RepoPath, BlobId>, baseCommit: string | null | undefined, pending?: StoredState['pending'], lastSyncAt?: number): Promise<void> {
		const state: StoredState = {
			version: 1,
			targetKey: config.targetKey,
			deviceId: config.deviceId,
			files: Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
		};
		if (baseCommit) state.baseCommit = baseCommit;
		if (pending && Object.keys(pending).length) state.pending = pending;
		const syncedAt = lastSyncAt ?? this.stored?.lastSyncAt;
		if (syncedAt) state.lastSyncAt = syncedAt;
		await config.state.save(state);
		this.stored = state;
	}

	private requireConfig(): EngineConfig {
		if (!this.config) throw new Error('Connect SyncLab to GitLab first.');
		return this.config;
	}

	private patch(partial: Partial<EngineState>): void {
		this.state.update(s => ({ ...s, ...partial }));
	}

	private step(): void {
		this.state.update(s => (s.progress ? { ...s, progress: { ...s.progress, done: Math.min(s.progress.total, s.progress.done + 1) } } : s));
	}

	private log(kind: LogKind, text: string): void {
		const entry: LogEntry = { id: ++this.logId, at: Date.now(), kind, text };
		this.state.update(s => ({ ...s, log: [...s.log, entry].slice(-LOG_LIMIT) }));
	}

	clearLog(): void {
		this.patch({ log: [] });
	}
}

function needsDeleteConfirmation(deletions: number, tracked: number): boolean {
	return deletions >= 10 || (deletions >= 3 && tracked > 0 && deletions / tracked >= 0.2);
}

function filterMap(map: Map<RepoPath, BlobId>, keep: (path: RepoPath) => boolean): Map<RepoPath, BlobId> {
	const out = new Map<RepoPath, BlobId>();
	for (const [path, blob] of map) if (keep(path)) out.set(path, blob);
	return out;
}

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++] as T;
			await fn(item);
		}
	});
	await Promise.all(workers);
}

/** Turns prepared pushes into commit actions, pairing an identical delete + create into a move. */
function toActions(prepared: Array<{ item: PushItem; blob: BlobId | null; content?: string; lastCommitId?: string }>): PreparedAction[] {
	const creates = prepared.filter(p => p.item.op === 'create');
	const paired = new Set<RepoPath>();
	const actions: PreparedAction[] = [];

	for (const p of prepared) {
		if (p.item.op !== 'delete') continue;
		const target = creates.find(c => !paired.has(c.item.path) && c.blob === p.item.remoteBlob);
		if (target && target.blob) {
			paired.add(target.item.path);
			paired.add(p.item.path);
			actions.push({
				action: { action: 'move', previous_path: p.item.path, file_path: target.item.path, last_commit_id: p.lastCommitId },
				kind: 'move',
				size: 0,
				effects: [[p.item.path, null], [target.item.path, target.blob]],
				label: `Moved ${p.item.path} → ${target.item.path}`,
			});
		}
	}

	for (const p of prepared) {
		if (paired.has(p.item.path)) continue;
		const { item } = p;
		if (item.op === 'delete') {
			actions.push({
				action: { action: 'delete', file_path: item.path, last_commit_id: p.lastCommitId },
				kind: 'delete',
				size: 0,
				effects: [[item.path, null]],
				label: `Deleted ${item.path} on GitLab`,
			});
		} else {
			const action: CommitAction = { action: item.op, file_path: item.path, content: p.content, encoding: 'base64' };
			if (item.op === 'update') action.last_commit_id = p.lastCommitId;
			actions.push({
				action,
				kind: item.op === 'create' ? 'add' : 'update',
				size: p.content?.length ?? 0,
				effects: [[item.path, p.blob]],
				label: `Pushed ${item.path}`,
			});
		}
	}
	return actions;
}

function chunkBySize(actions: PreparedAction[], maxBytes: number): PreparedAction[][] {
	const chunks: PreparedAction[][] = [];
	let current: PreparedAction[] = [];
	let size = 0;
	for (const action of actions) {
		if (current.length && size + action.size > maxBytes) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(action);
		size += action.size;
	}
	if (current.length) chunks.push(current);
	return chunks;
}

function describeSummary(s: SyncSummary): string {
	const parts: string[] = [];
	if (s.pulled) parts.push(`${s.pulled} pulled`);
	if (s.pushed) parts.push(`${s.pushed} pushed`);
	if (s.deleted) parts.push(`${s.deleted} deleted`);
	if (s.failed) parts.push(`${s.failed} failed`);
	if (s.conflicts) parts.push(`${s.conflicts} conflict${s.conflicts === 1 ? '' : 's'} waiting`);
	return parts.length ? `Done: ${parts.join(', ')}.` : 'Everything was already in sync.';
}

function errorKindOf(error: unknown): string | undefined {
	return error instanceof GitLabError ? error.kind : undefined;
}

export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
