import { gitBlobId } from '../../src/core/blobHash';
import type { BlobId, RepoPath } from '../../src/core/types';
import { fromBase64, toBase64 } from '../../src/engine/base64';
import type { LocalFs, RemoteRepo } from '../../src/engine/ports';
import { SyncEngine, type EngineConfig } from '../../src/engine/SyncEngine';
import { StateStore, type StateSlots } from '../../src/engine/StateStore';
import { GitLabError, type CommitAction } from '../../src/gitlab/GitLabClient';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytes(text: string): ArrayBuffer {
	return encoder.encode(text).buffer;
}

export function text(data: ArrayBuffer | Uint8Array | undefined | null): string | undefined {
	return data ? decoder.decode(data) : undefined;
}

interface FakeCommit {
	id: string;
	files: Map<RepoPath, BlobId>;
	lastCommit: Map<RepoPath, string>;
	message: string;
	actions: CommitAction[];
}

/**
 * In-memory GitLab branch with the commit semantics SyncLab relies on:
 * `create` fails if the file exists, and update/delete/move fail when
 * `last_commit_id` isn't the file's latest commit.
 */
export class FakeGitLab implements RemoteRepo {
	readonly commits: FakeCommit[] = [];
	readonly blobs = new Map<BlobId, Uint8Array>();
	calls = { head: 0, tree: 0, blob: 0, fileInfo: 0, commit: 0 };
	/** Downloads in progress right now, and the most seen at once. */
	inFlight = 0;
	maxInFlight = 0;
	/** Runs once, right before the next commit is validated (simulates a racing writer). */
	beforeNextCommit?: () => Promise<void>;
	/** Make the next commit fail with a network error, either before or after it lands. */
	dropNextCommitResponse?: 'before-apply' | 'after-apply';

	get headCommit(): FakeCommit | undefined {
		return this.commits[this.commits.length - 1];
	}

	async head(): Promise<string | null> {
		this.calls.head++;
		return this.headCommit?.id ?? null;
	}

	async tree(commit: string): Promise<Map<RepoPath, BlobId>> {
		this.calls.tree++;
		return new Map(this.find(commit).files);
	}

	async blob(id: BlobId): Promise<ArrayBuffer> {
		this.calls.blob++;
		this.inFlight++;
		this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
		await new Promise(resolve => setTimeout(resolve, 0));
		this.inFlight--;
		const data = this.blobs.get(id);
		if (!data) throw new GitLabError('not-found', `No blob ${id}`, 404);
		return data.slice().buffer;
	}

	async fileInfo(path: RepoPath, commit: string): Promise<{ blobId: BlobId; lastCommitId: string } | null> {
		this.calls.fileInfo++;
		const c = this.find(commit);
		const blobId = c.files.get(path);
		return blobId ? { blobId, lastCommitId: c.lastCommit.get(path) as string } : null;
	}

	async commit(message: string, actions: CommitAction[]): Promise<{ id: string }> {
		this.calls.commit++;
		const hook = this.beforeNextCommit;
		this.beforeNextCommit = undefined;
		if (hook) await hook();

		const drop = this.dropNextCommitResponse;
		this.dropNextCommitResponse = undefined;
		if (drop === 'before-apply') throw new GitLabError('network', 'Connection reset');

		const id = await this.apply(message, actions);
		if (drop === 'after-apply') throw new GitLabError('network', 'Connection reset');
		return { id };
	}

	/** A change made by someone else (another device, the GitLab web editor…). */
	async externalCommit(changes: Record<RepoPath, string | Uint8Array | null>): Promise<string> {
		const current = this.headCommit;
		const actions: CommitAction[] = Object.entries(changes).map(([path, content]) => {
			const exists = current?.files.has(path) ?? false;
			if (content === null) return { action: 'delete', file_path: path };
			const data = typeof content === 'string' ? encoder.encode(content) : content;
			return { action: exists ? 'update' : 'create', file_path: path, content: toBase64(data.slice().buffer), encoding: 'base64' };
		});
		return this.apply('external change', actions);
	}

	files(): Map<RepoPath, string | undefined> {
		const out = new Map<RepoPath, string | undefined>();
		for (const [path, blob] of this.headCommit?.files ?? []) out.set(path, text(this.blobs.get(blob)));
		return out;
	}

	private find(commit: string): FakeCommit {
		const c = this.commits.find(x => x.id === commit);
		if (!c) throw new GitLabError('not-found', `No commit ${commit}`, 404);
		return c;
	}

	private async apply(message: string, actions: CommitAction[]): Promise<string> {
		const files = new Map(this.headCommit?.files ?? []);
		const lastCommit = new Map(this.headCommit?.lastCommit ?? []);
		const id = `commit-${this.commits.length + 1}`;
		const touched: RepoPath[] = [];

		const checkLock = (path: RepoPath, lastCommitId?: string) => {
			if (!files.has(path)) throw new GitLabError('rejected', `A file with this name doesn't exist: ${path}`, 400);
			if (lastCommitId && lastCommit.get(path) !== lastCommitId) {
				throw new GitLabError('rejected', 'You are attempting to update a file that has changed since you started editing it.', 400);
			}
		};

		for (const action of actions) {
			const path = action.file_path;
			if (action.action === 'create') {
				if (files.has(path)) throw new GitLabError('rejected', 'A file with this name already exists', 400);
			} else if (action.action === 'move') {
				checkLock(action.previous_path as string, action.last_commit_id);
				if (files.has(path)) throw new GitLabError('rejected', 'A file with this name already exists', 400);
			} else {
				checkLock(path, action.last_commit_id);
			}

			if (action.action === 'delete') {
				files.delete(path);
				lastCommit.delete(path);
			} else if (action.action === 'move') {
				const previous = action.previous_path as string;
				const blob = files.get(previous) as BlobId;
				files.delete(previous);
				lastCommit.delete(previous);
				files.set(path, blob);
			} else {
				const data = new Uint8Array(fromBase64(action.content ?? ''));
				const blob = await gitBlobId(data);
				this.blobs.set(blob, data);
				files.set(path, blob);
			}
			touched.push(path);
		}

		for (const path of touched) if (files.has(path)) lastCommit.set(path, id);
		this.commits.push({ id, files, lastCommit, message, actions });
		return id;
	}
}

/** In-memory vault. */
export class FakeVault implements LocalFs {
	readonly files = new Map<RepoPath, { data: Uint8Array; mtime: number }>();
	readonly trashed: Array<{ path: RepoPath; data: Uint8Array }> = [];
	writes = 0;
	private clock = 1;
	/** Called before each read; lets a test edit a file mid-sync. */
	beforeRead?: (path: RepoPath, count: number) => void;
	private readonly readCounts = new Map<RepoPath, number>();

	set(path: RepoPath, content: string | Uint8Array): void {
		const data = typeof content === 'string' ? encoder.encode(content) : content;
		this.files.set(path, { data, mtime: this.clock++ });
	}

	remove(path: RepoPath): void {
		this.files.delete(path);
	}

	get(path: RepoPath): string | undefined {
		return text(this.files.get(path)?.data);
	}

	snapshot(): Map<RepoPath, string | undefined> {
		const out = new Map<RepoPath, string | undefined>();
		for (const path of [...this.files.keys()].sort()) out.set(path, this.get(path));
		return out;
	}

	async list(): Promise<Array<{ path: RepoPath; size: number; mtime: number }>> {
		return [...this.files].map(([path, f]) => ({ path, size: f.data.byteLength, mtime: f.mtime }));
	}

	async read(path: RepoPath): Promise<ArrayBuffer | null> {
		const count = (this.readCounts.get(path) ?? 0) + 1;
		this.readCounts.set(path, count);
		this.beforeRead?.(path, count);
		const file = this.files.get(path);
		return file ? file.data.slice().buffer : null;
	}

	async write(path: RepoPath, data: ArrayBuffer): Promise<void> {
		this.writes++;
		this.files.set(path, { data: new Uint8Array(data.slice(0)), mtime: this.clock++ });
	}

	async trash(path: RepoPath): Promise<void> {
		const file = this.files.get(path);
		if (!file) return;
		this.trashed.push({ path, data: file.data });
		this.files.delete(path);
		this.writes++;
	}
}

export class MemorySlots implements StateSlots {
	readonly data = new Map<'a' | 'b', string>();
	failWrites = false;
	async read(slot: 'a' | 'b'): Promise<string | null> {
		return this.data.get(slot) ?? null;
	}
	async write(slot: 'a' | 'b', value: string): Promise<void> {
		if (this.failWrites) throw new Error('disk full');
		this.data.set(slot, value);
	}
}

export interface Device {
	engine: SyncEngine;
	vault: FakeVault;
	slots: MemorySlots;
	config: EngineConfig;
}

export function makeDevice(remote: FakeGitLab, overrides: Partial<EngineConfig> & { vault?: FakeVault; slots?: MemorySlots } = {}): Device {
	const vault = overrides.vault ?? new FakeVault();
	const slots = overrides.slots ?? new MemorySlots();
	const config: EngineConfig = {
		remote,
		local: vault,
		state: new StateStore(slots),
		targetKey: 'https://gitlab.example|1|main|',
		deviceId: 'device-1',
		deviceName: 'test device',
		isIgnored: () => false,
		maxFileBytes: 20 * 1024 * 1024,
		now: () => new Date(2026, 9, 4, 14, 32),
		...overrides,
	};
	const engine = new SyncEngine();
	engine.configure(config);
	return { engine, vault, slots, config };
}
