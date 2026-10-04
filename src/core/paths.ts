import ignore from 'ignore';
import type { RepoPath } from './types';

/** Normalizes a user-entered folder: trims slashes and whitespace. '' means the whole vault. */
export function normalizeFolder(folder: string): string {
	return folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Vault path → repository path, or null when the file is outside the synced folder. */
export function toRepoPath(vaultPath: string, folder: string): RepoPath | null {
	if (!folder) return vaultPath;
	const prefix = folder + '/';
	return vaultPath.startsWith(prefix) ? vaultPath.slice(prefix.length) : null;
}

/** Repository path → vault path. */
export function toVaultPath(repoPath: RepoPath, folder: string): string {
	return folder ? `${folder}/${repoPath}` : repoPath;
}

/** Syncthing's conflict copies (`note.sync-conflict-20260404-201849-OASEYZQ.md`) and Windows temp files (`~syncthing~note.md.tmp`). */
const SYNCTHING_FILE = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.|$)|^~syncthing~.*\.tmp$/;

/**
 * Paths SyncLab never syncs, whatever the settings say: anything inside a
 * dot-folder or named with a leading dot (.obsidian, .trash, .git, .gitignore …),
 * and files another sync tool (Syncthing) creates for its own bookkeeping.
 */
export function isHardExcluded(repoPath: RepoPath): boolean {
	const parts = repoPath.split('/');
	if (parts.some(part => part.startsWith('.'))) return true;
	return SYNCTHING_FILE.test(parts[parts.length - 1] ?? '');
}

/** Builds a matcher for .gitignore-style patterns (one per line, # comments allowed). */
export function createIgnoreMatcher(...patternSources: string[]): (repoPath: RepoPath) => boolean {
	const matcher = ignore();
	for (const source of patternSources) {
		if (source.trim()) matcher.add(source);
	}
	return path => matcher.ignores(path);
}
