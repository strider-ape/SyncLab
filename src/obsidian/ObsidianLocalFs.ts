import { normalizePath, TFile, type App } from 'obsidian';
import { toRepoPath, toVaultPath } from '../core/paths';
import type { RepoPath } from '../core/types';
import type { LocalFs } from '../engine/ports';

/**
 * The vault through Obsidian's Vault API. Only files Obsidian indexes are
 * visible, so the config folder and other dot-folders never appear here.
 */
export class ObsidianLocalFs implements LocalFs {
	constructor(private readonly app: App, private readonly folder: string) {}

	async list(): Promise<Array<{ path: RepoPath; size: number; mtime: number }>> {
		const out: Array<{ path: RepoPath; size: number; mtime: number }> = [];
		for (const file of this.app.vault.getFiles()) {
			const path = toRepoPath(file.path, this.folder);
			if (path !== null) out.push({ path, size: file.stat.size, mtime: file.stat.mtime });
		}
		return out;
	}

	async read(path: RepoPath): Promise<ArrayBuffer | null> {
		const file = this.file(path);
		return file ? this.app.vault.readBinary(file) : null;
	}

	async write(path: RepoPath, data: ArrayBuffer): Promise<void> {
		const vaultPath = normalizePath(toVaultPath(path, this.folder));
		const existing = this.app.vault.getFileByPath(vaultPath);
		if (existing) {
			await this.app.vault.modifyBinary(existing, data);
			return;
		}
		await this.ensureFolder(vaultPath.split('/').slice(0, -1).join('/'));
		await this.app.vault.createBinary(vaultPath, data);
	}

	async trash(path: RepoPath): Promise<void> {
		const file = this.file(path);
		// Follows the user's "Deleted files" preference (system trash or .trash by default).
		if (file) await this.app.fileManager.trashFile(file);
	}

	private file(path: RepoPath): TFile | null {
		return this.app.vault.getFileByPath(normalizePath(toVaultPath(path, this.folder)));
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!folder) return;
		let current = '';
		for (const part of folder.split('/')) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getFolderByPath(current)) await this.app.vault.createFolder(current);
		}
	}
}
