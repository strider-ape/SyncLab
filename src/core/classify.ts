import type { BlobId, Decision } from './types';

/**
 * The one rule table. Every status the UI shows and every action Sync takes
 * comes from this function, given the blob of a path at the last sync (base),
 * in the vault (local) and on GitLab (remote). `undefined` means absent.
 *
 * Identical sides are always in sync, which is what makes repeated syncs
 * no-ops. Anything that isn't provably one-sided is a conflict.
 */
export function classify(base: BlobId | undefined, local: BlobId | undefined, remote: BlobId | undefined): Decision {
	if (local === remote) return { kind: 'in-sync' };

	if (base === undefined) {
		if (remote === undefined) return { kind: 'push', op: 'create' };
		if (local === undefined) return { kind: 'pull', op: 'create' };
		return { kind: 'conflict', reason: 'no-history' };
	}

	if (local === base) {
		// Only GitLab changed. local === base implies the local file exists.
		return remote === undefined ? { kind: 'pull', op: 'delete' } : { kind: 'pull', op: 'update' };
	}
	if (remote === base) {
		// Only the vault changed.
		return local === undefined ? { kind: 'push', op: 'delete' } : { kind: 'push', op: 'update' };
	}

	if (local === undefined) return { kind: 'conflict', reason: 'deleted-here-changed-there' };
	if (remote === undefined) return { kind: 'conflict', reason: 'changed-here-deleted-there' };
	return { kind: 'conflict', reason: 'both-changed' };
}
