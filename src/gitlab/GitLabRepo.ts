import type { BlobId, RepoPath } from '../core/types';
import type { RemoteRepo } from '../engine/ports';
import type { CommitAction, GitLabClient } from './GitLabClient';

const SYMLINK_MODE = '120000';

/** One branch of one GitLab project, as the sync engine sees it. */
export class GitLabRepo implements RemoteRepo {
	constructor(
		private readonly client: GitLabClient,
		private readonly projectId: number,
		private readonly branch: string,
	) {}

	head(): Promise<string | null> {
		return this.client.branchHead(this.projectId, this.branch);
	}

	async tree(commit: string): Promise<Map<RepoPath, BlobId>> {
		const entries = await this.client.listTree(this.projectId, commit);
		const tree = new Map<RepoPath, BlobId>();
		for (const entry of entries) {
			// Folders, submodules and symlinks are not files SyncLab can mirror.
			if (entry.type === 'blob' && entry.mode !== SYMLINK_MODE) tree.set(entry.path, entry.id);
		}
		return tree;
	}

	blob(id: BlobId): Promise<ArrayBuffer> {
		return this.client.blobRaw(this.projectId, id);
	}

	fileInfo(path: RepoPath, commit: string): Promise<{ blobId: BlobId; lastCommitId: string } | null> {
		return this.client.fileInfo(this.projectId, path, commit);
	}

	async commit(message: string, actions: CommitAction[]): Promise<{ id: string }> {
		const commit = await this.client.createCommit(this.projectId, this.branch, message, actions);
		return { id: commit.id };
	}
}
