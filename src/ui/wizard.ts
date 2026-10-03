import { GitLabError, type GitLabClient, type GitLabProject } from '../gitlab/GitLabClient';

export interface WizardResult {
	gitlabUrl: string;
	token: string;
	project: GitLabProject;
	branch: string;
	folder: string;
	deviceName: string;
}

export interface WizardHost {
	initialUrl: string;
	initialFolder: string;
	initialDeviceName: string;
	existingToken: string | null;
	folders: string[];
	client(url: string, token: string): GitLabClient;
	openUrl(url: string): void;
	finish(result: WizardResult): Promise<void>;
	close(): void;
}

/** GitLab's token page with name and scope already filled in. */
export function tokenPageUrl(baseUrl: string): string {
	const params = new URLSearchParams({ name: 'SyncLab', scopes: 'api', description: 'Obsidian SyncLab plugin' });
	return `${baseUrl}/-/user_settings/personal_access_tokens?${params.toString()}`;
}

/** Accepts https URLs, plus plain http for a GitLab running on this machine. */
export function validateGitLabUrl(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return 'Enter the full address, like https://gitlab.example.com';
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
		return 'Use an https:// address so your token is sent encrypted.';
	}
	return null;
}

export function explain(error: unknown, context: 'token' | 'project' | 'general' = 'general'): string {
	if (error instanceof GitLabError) {
		switch (error.kind) {
			case 'unauthorized': return 'GitLab didn’t accept this token. Check it was copied fully and hasn’t expired.';
			case 'forbidden': return context === 'token'
				? 'This token can’t use the API. Create one with the "api" scope.'
				: 'Your token isn’t allowed to do this. It needs the "api" scope and Developer access.';
			case 'not-found': return context === 'project' ? 'That project wasn’t found, or your token can’t see it.' : 'GitLab couldn’t find that. Check the address.';
			case 'network': return 'Couldn’t reach GitLab. Check the address and your connection.';
			default: return error.message;
		}
	}
	return error instanceof Error ? error.message : String(error);
}

export function accessLevel(project: GitLabProject): number {
	return Math.max(project.permissions?.project_access?.access_level ?? 0, project.permissions?.group_access?.access_level ?? 0);
}
