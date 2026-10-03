/** Git blob SHA-1: 40 lowercase hex characters. Identical to GitLab's blob id. */
export type BlobId = string;

/** Repository-relative path with forward slashes and no leading slash. */
export type RepoPath = string;

/** A snapshot of one side (base, local or remote): path → blob id. */
export type Tree = ReadonlyMap<RepoPath, BlobId>;

export type Op = 'create' | 'update' | 'delete';

export type ConflictReason =
	/** Both sides changed the file differently since the last sync. */
	| 'both-changed'
	/** No sync history for this path, and the two sides differ. */
	| 'no-history'
	/** Deleted in the vault, edited on GitLab. */
	| 'deleted-here-changed-there'
	/** Edited in the vault, deleted on GitLab. */
	| 'changed-here-deleted-there';

export type Decision =
	| { kind: 'in-sync' }
	| { kind: 'push'; op: Op }
	| { kind: 'pull'; op: Op }
	| { kind: 'conflict'; reason: ConflictReason };

export type Resolution = 'mine' | 'theirs' | 'both';

/** A path whose sides differ, with the decision the rule table made for it. */
export interface Change {
	path: RepoPath;
	base?: BlobId;
	local?: BlobId;
	remote?: BlobId;
	decision: Exclude<Decision, { kind: 'in-sync' }>;
}

export interface Attention {
	path: RepoPath;
	reason: 'case-collision';
}

export interface ChangeSet {
	changes: Change[];
	/** Paths where local and remote already match; their base is recorded as-is. */
	inSync: Array<{ path: RepoPath; blob?: BlobId }>;
	/** Paths SyncLab refuses to touch until the user fixes them. */
	attention: Attention[];
}

export interface PushItem {
	path: RepoPath;
	op: Op;
	/** Blob expected in the vault (create/update). */
	localBlob?: BlobId;
	/** Blob expected on GitLab right now (update/delete); verified before committing. */
	remoteBlob?: BlobId;
}

export interface PullItem {
	path: RepoPath;
	op: Op;
	/** Blob to download (create/update). */
	remoteBlob?: BlobId;
	/** Blob expected in the vault right now; the write is skipped if the file changed meanwhile. */
	localBlob?: BlobId;
	/** Move the current local file to trash before replacing it. */
	backupLocal: boolean;
}

export interface SyncPlan {
	pull: PullItem[];
	push: PushItem[];
	/** Conflicts without a resolution; left untouched by this sync. */
	conflicts: Change[];
	/** Changes the user unchecked; left untouched by this sync. */
	skipped: Change[];
	inSync: ChangeSet['inSync'];
}
