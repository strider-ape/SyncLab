import { classify } from './classify';
import type { Attention, BlobId, Change, ChangeSet, PullItem, PushItem, RepoPath, Resolution, SyncPlan, Tree } from './types';

/**
 * Compares the three snapshots path by path. Pure: the same inputs always give
 * the same change set, which is what lets the UI preview exactly what Sync does.
 */
export function computeChanges(base: Tree, local: Tree, remote: Tree): ChangeSet {
	const attentionPaths = new Set([...caseCollisions(local.keys()), ...caseCollisions(remote.keys())]);
	const attention: Attention[] = [...attentionPaths].sort().map(path => ({ path, reason: 'case-collision' }));

	const paths = new Set<RepoPath>([...base.keys(), ...local.keys(), ...remote.keys()]);
	const changes: Change[] = [];
	const inSync: ChangeSet['inSync'] = [];

	for (const path of [...paths].sort()) {
		if (attentionPaths.has(path)) continue;
		const b = base.get(path);
		const l = local.get(path);
		const r = remote.get(path);
		const decision = classify(b, l, r);
		if (decision.kind === 'in-sync') {
			inSync.push(l === undefined ? { path } : { path, blob: l });
		} else {
			changes.push({ path, base: b, local: l, remote: r, decision });
		}
	}
	return { changes, inSync, attention };
}

export interface PlanOptions {
	/** Changes the user unchecked in the sidebar. */
	excluded?: ReadonlySet<RepoPath>;
	/** The user's choice for each conflict. */
	resolutions?: ReadonlyMap<RepoPath, Resolution>;
	/** Used to name "keep both" copies. */
	now?: Date;
}

/** Turns a change set plus the user's choices into concrete pull and push items. */
export function buildPlan(set: ChangeSet, options: PlanOptions = {}): SyncPlan {
	const excluded = options.excluded ?? new Set<RepoPath>();
	const resolutions = options.resolutions ?? new Map<RepoPath, Resolution>();
	const taken = new Set(set.changes.map(c => c.path.toLowerCase()));
	for (const entry of set.inSync) taken.add(entry.path.toLowerCase());

	const plan: SyncPlan = { pull: [], push: [], conflicts: [], skipped: [], inSync: set.inSync };

	for (const change of set.changes) {
		if (excluded.has(change.path)) {
			plan.skipped.push(change);
			continue;
		}
		const { decision } = change;
		if (decision.kind === 'push') {
			plan.push.push(pushItem(change.path, decision.op, change.local, change.remote));
		} else if (decision.kind === 'pull') {
			plan.pull.push(pullItem(change.path, decision.op, change.remote, change.local, false));
		} else {
			const resolution = resolutions.get(change.path);
			if (!resolution) plan.conflicts.push(change);
			else resolveConflict(change, resolution, plan, taken, options.now ?? new Date());
		}
	}

	// Deletions first so a case-only rename works on case-insensitive file systems.
	plan.pull.sort((a, b) => Number(b.op === 'delete') - Number(a.op === 'delete'));
	return plan;
}

function resolveConflict(change: Change, resolution: Resolution, plan: SyncPlan, taken: Set<string>, now: Date): void {
	const { path, local, remote } = change;

	if (resolution === 'both' && local !== undefined && remote !== undefined) {
		// Keep the vault version at its path and save GitLab's version next to it.
		const copyPath = conflictCopyPath(path, now, taken);
		taken.add(copyPath.toLowerCase());
		plan.push.push(pushItem(path, 'update', local, remote));
		plan.pull.push(pullItem(copyPath, 'create', remote, undefined, false));
		plan.push.push(pushItem(copyPath, 'create', remote, undefined));
		return;
	}

	// "Both" with one side missing keeps the side that still has content.
	const keepMine = resolution === 'mine' || (resolution === 'both' && local !== undefined);
	if (keepMine) {
		const op = local === undefined ? 'delete' : remote === undefined ? 'create' : 'update';
		plan.push.push(pushItem(path, op, local, remote));
	} else {
		const op = remote === undefined ? 'delete' : local === undefined ? 'create' : 'update';
		plan.pull.push(pullItem(path, op, remote, local, local !== undefined));
	}
}

function pushItem(path: RepoPath, op: PushItem['op'], localBlob?: BlobId, remoteBlob?: BlobId): PushItem {
	const item: PushItem = { path, op };
	if (localBlob !== undefined && op !== 'delete') item.localBlob = localBlob;
	if (remoteBlob !== undefined && op !== 'create') item.remoteBlob = remoteBlob;
	return item;
}

function pullItem(path: RepoPath, op: PullItem['op'], remoteBlob: BlobId | undefined, localBlob: BlobId | undefined, backupLocal: boolean): PullItem {
	const item: PullItem = { path, op, backupLocal };
	if (remoteBlob !== undefined && op !== 'delete') item.remoteBlob = remoteBlob;
	if (localBlob !== undefined) item.localBlob = localBlob;
	return item;
}

/** `Projects/plan.md` → `Projects/plan (GitLab 2026-10-04 1432).md`, unique among `taken`. */
export function conflictCopyPath(path: RepoPath, now: Date, taken: ReadonlySet<string> = new Set()): RepoPath {
	const slash = path.lastIndexOf('/');
	const dir = path.slice(0, slash + 1);
	const name = path.slice(slash + 1);
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;

	for (let i = 1; ; i++) {
		const suffix = i === 1 ? '' : ` ${i}`;
		const candidate = `${dir}${stem} (GitLab ${stamp}${suffix})${ext}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
}

/** Paths that collide with another path when compared case-insensitively. */
function caseCollisions(paths: Iterable<RepoPath>): RepoPath[] {
	const groups = new Map<string, RepoPath[]>();
	for (const path of paths) {
		const key = path.normalize('NFC').toLowerCase();
		const group = groups.get(key);
		if (group) group.push(path);
		else groups.set(key, [path]);
	}
	return [...groups.values()].filter(group => group.length > 1).flat();
}

/** Number of deletions a plan performs (local and remote). */
export function countDeletions(plan: SyncPlan): number {
	return plan.pull.filter(item => item.op === 'delete').length + plan.push.filter(item => item.op === 'delete').length;
}
