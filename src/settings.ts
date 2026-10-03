import { normalizeBaseUrl } from './gitlab/GitLabClient';
import { normalizeFolder } from './core/paths';

export interface SyncLabSettings {
	gitlabUrl: string;
	/** Name of the secret in Obsidian's secret storage that holds the token. Never the token itself. */
	tokenSecret: string;
	projectId: number | null;
	projectPath: string;
	projectWebUrl: string;
	branch: string;
	/** Vault folder mirrored to the repository root. '' = the whole vault. */
	folder: string;
	ignorePatterns: string;
	deviceName: string;
	maxFileSizeMB: number;
}

export const DEFAULT_TOKEN_SECRET = 'synclab-gitlab-token';

export const DEFAULT_SETTINGS: SyncLabSettings = {
	gitlabUrl: 'https://gitlab.com',
	tokenSecret: DEFAULT_TOKEN_SECRET,
	projectId: null,
	projectPath: '',
	projectWebUrl: '',
	branch: '',
	folder: '',
	ignorePatterns: '',
	deviceName: '',
	maxFileSizeMB: 20,
};

export function isConfigured(settings: SyncLabSettings): boolean {
	return Boolean(settings.gitlabUrl && settings.projectId && settings.branch && settings.tokenSecret);
}

/** Everything that defines "where" we sync. Changing any part starts a fresh, safe history. */
export function targetKey(settings: SyncLabSettings): string {
	return [normalizeBaseUrl(settings.gitlabUrl), settings.projectId ?? '', settings.branch, normalizeFolder(settings.folder)].join('|');
}
