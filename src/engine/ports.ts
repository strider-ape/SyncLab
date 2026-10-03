import type { BlobId, RepoPath } from '../core/types';
import type { CommitAction } from '../gitlab/GitLabClient';

/** The vault, seen through repository paths (the synced folder is already stripped). */
export interface LocalFs {
	/** Every file in scope with its size and modification time. */
	list(): Promise<Array<{ path: RepoPath; size: number; mtime: number }>>;
	/** File bytes, or null if the file doesn't exist. */
	read(path: RepoPath): Promise<ArrayBuffer | null>;
	/** Creates or overwrites a file, creating parent folders as needed. */
	write(path: RepoPath, data: ArrayBuffer): Promise<void>;
	/** Moves a file to the trash, following the user's "Deleted files" preference. */
	trash(path: RepoPath): Promise<void>;
}

/** One GitLab branch. */
export interface RemoteRepo {
	/** Commit id at the branch tip, or null if the branch has no commits yet. */
	head(): Promise<string | null>;
	/** Files at a commit: path → blob id. Symlinks and submodules are left out. */
	tree(commit: string): Promise<Map<RepoPath, BlobId>>;
	blob(id: BlobId): Promise<ArrayBuffer>;
	/** Blob id and last commit id of a file at a commit, or null if absent. */
	fileInfo(path: RepoPath, commit: string): Promise<{ blobId: BlobId; lastCommitId: string } | null>;
	commit(message: string, actions: CommitAction[]): Promise<{ id: string }>;
}

export interface StoredState {
	version: 1;
	/** Which GitLab project, branch and folder this state belongs to. */
	targetKey: string;
	/** Which device wrote it. State copied from another device is ignored. */
	deviceId: string;
	/** Remote commit at the end of the last sync. */
	baseCommit?: string;
	/** Blob of every path as of the last sync. */
	files: Record<RepoPath, BlobId>;
	/** Write-ahead record of an in-flight commit: path → blob, or null for a deletion. */
	pending?: Record<RepoPath, BlobId | null>;
	lastSyncAt?: number;
}

export interface StatePersistence {
	load(): Promise<StoredState | null>;
	save(state: StoredState): Promise<void>;
}
