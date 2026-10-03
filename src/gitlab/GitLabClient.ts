import type { HttpFn, HttpRequest, HttpResponse } from './http';

export type GitLabErrorKind =
	| 'unauthorized'
	| 'forbidden'
	| 'not-found'
	/** 400/409/422: GitLab refused the request, e.g. a file changed since we looked. */
	| 'rejected'
	| 'rate-limited'
	| 'server'
	/** No response. For a commit this means it may or may not have landed. */
	| 'network'
	| 'bad-response';

export class GitLabError extends Error {
	constructor(readonly kind: GitLabErrorKind, message: string, readonly status?: number) {
		super(message);
		this.name = 'GitLabError';
	}
}

export interface GitLabUser { id: number; username: string; name: string; avatar_url?: string }
export interface GitLabProject {
	id: number;
	name: string;
	path_with_namespace: string;
	default_branch?: string;
	web_url: string;
	empty_repo?: boolean;
	permissions?: {
		project_access?: { access_level: number } | null;
		group_access?: { access_level: number } | null;
	};
}
export interface GitLabBranch { name: string; default: boolean; protected: boolean; developers_can_push: boolean; commit: { id: string } }
export interface GitLabTreeEntry { id: string; name: string; type: 'blob' | 'tree' | 'commit'; path: string; mode: string }
export interface GitLabCommit { id: string; parent_ids: string[]; web_url?: string }

export interface CommitAction {
	action: 'create' | 'update' | 'delete' | 'move';
	file_path: string;
	previous_path?: string;
	content?: string;
	encoding?: 'base64';
	last_commit_id?: string;
}

export interface ClientOptions {
	baseUrl: string;
	token: string;
	http: HttpFn;
	/** Injected so tests don't wait. */
	sleep?: (ms: number) => Promise<void>;
	maxAttempts?: number;
}

/** The Developer role (30) is the minimum that can push to unprotected branches. */
export const DEVELOPER_ACCESS = 30;

/** Thin, typed GitLab REST v4 client with retries for safe requests. */
export class GitLabClient {
	private readonly api: string;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly maxAttempts: number;

	constructor(private readonly options: ClientOptions) {
		this.api = `${normalizeBaseUrl(options.baseUrl)}/api/v4`;
		this.sleep = options.sleep ?? (ms => new Promise(resolve => window.setTimeout(resolve, ms)));
		this.maxAttempts = options.maxAttempts ?? 4;
	}

	version(): Promise<{ version: string }> {
		return this.json('GET', '/version');
	}

	currentUser(): Promise<GitLabUser> {
		return this.json('GET', '/user');
	}

	searchProjects(search: string): Promise<GitLabProject[]> {
		return this.json('GET', `/projects${query({ membership: 'true', order_by: 'last_activity_at', per_page: '20', search: search.trim() || undefined })}`);
	}

	getProject(projectId: number): Promise<GitLabProject> {
		return this.json('GET', `/projects/${projectId}`);
	}

	createProject(name: string): Promise<GitLabProject> {
		return this.json('POST', '/projects', { name, visibility: 'private', initialize_with_readme: true });
	}

	listBranches(projectId: number): Promise<GitLabBranch[]> {
		return this.json('GET', `/projects/${projectId}/repository/branches${query({ per_page: '100' })}`);
	}

	/** Commit id at the tip of `branch`, or null if the branch doesn't exist. */
	async branchHead(projectId: number, branch: string): Promise<string | null> {
		try {
			const result = await this.json<GitLabBranch>('GET', `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`);
			return result.commit.id;
		} catch (error) {
			if (error instanceof GitLabError && error.kind === 'not-found') return null;
			throw error;
		}
	}

	/** Every entry of the tree at `ref` (pinned to a commit id by callers), following keyset pages. */
	async listTree(projectId: number, ref: string): Promise<GitLabTreeEntry[]> {
		const entries: GitLabTreeEntry[] = [];
		let url: string | null = `${this.api}/projects/${projectId}/repository/tree${query({ ref, recursive: 'true', per_page: '100', pagination: 'keyset' })}`;
		while (url) {
			const response = await this.send({ method: 'GET', url, headers: {} });
			entries.push(...parseJson<GitLabTreeEntry[]>(response));
			url = nextLink(response.headers['link']);
		}
		return entries;
	}

	async blobRaw(projectId: number, blobId: string): Promise<ArrayBuffer> {
		const response = await this.send({ method: 'GET', url: `${this.api}/projects/${projectId}/repository/blobs/${encodeURIComponent(blobId)}/raw`, headers: {} });
		return response.arrayBuffer;
	}

	/** Blob id and last commit id of a file at `ref`, or null if it doesn't exist there. */
	async fileInfo(projectId: number, path: string, ref: string): Promise<{ blobId: string; lastCommitId: string } | null> {
		try {
			const response = await this.send({
				method: 'HEAD',
				url: `${this.api}/projects/${projectId}/repository/files/${encodeURIComponent(path)}${query({ ref })}`,
				headers: {},
			});
			const blobId = response.headers['x-gitlab-blob-id'];
			const lastCommitId = response.headers['x-gitlab-last-commit-id'];
			if (!blobId || !lastCommitId) throw new GitLabError('bad-response', `GitLab didn't return file details for "${path}".`);
			return { blobId, lastCommitId };
		} catch (error) {
			if (error instanceof GitLabError && error.kind === 'not-found') return null;
			throw error;
		}
	}

	createCommit(projectId: number, branch: string, message: string, actions: CommitAction[]): Promise<GitLabCommit> {
		return this.json('POST', `/projects/${projectId}/repository/commits`, { branch, commit_message: message, actions });
	}

	private async json<T>(method: HttpRequest['method'], path: string, body?: unknown): Promise<T> {
		const response = await this.send({
			method,
			url: `${this.api}${path}`,
			headers: {},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return parseJson<T>(response);
	}

	private async send(request: HttpRequest): Promise<HttpResponse> {
		const prepared: HttpRequest = { ...request, headers: { ...request.headers, 'PRIVATE-TOKEN': this.options.token, Accept: 'application/json' } };
		// A commit that got no response may have landed, so it is never resent blindly.
		// Rate-limited (429) commits were not processed and are safe to retry.
		const idempotent = request.method !== 'POST';

		for (let attempt = 1; ; attempt++) {
			let response: HttpResponse;
			try {
				response = await this.options.http(prepared);
			} catch (error) {
				if (idempotent && attempt < this.maxAttempts) {
					await this.sleep(backoff(attempt));
					continue;
				}
				throw new GitLabError('network', `Couldn't reach GitLab. ${error instanceof Error ? error.message : String(error)}`.trim());
			}

			if (response.status >= 200 && response.status < 300) return response;

			const retryable = response.status === 429 || (idempotent && response.status >= 500);
			if (retryable && attempt < this.maxAttempts) {
				await this.sleep(retryDelay(response, attempt));
				continue;
			}
			throw toError(response);
		}
	}
}

export function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, '').replace(/\/api\/v4$/, '');
}

function query(params: Record<string, string | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, value);
	const text = search.toString();
	return text ? `?${text}` : '';
}

function parseJson<T>(response: HttpResponse): T {
	try {
		return JSON.parse(response.text) as T;
	} catch {
		throw new GitLabError('bad-response', 'GitLab sent a response SyncLab could not read.', response.status);
	}
}

function nextLink(link: string | undefined): string | null {
	if (!link) return null;
	for (const part of link.split(',')) {
		const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
		if (match?.[1]) return match[1];
	}
	return null;
}

function backoff(attempt: number): number {
	const base = Math.min(8000, 500 * 2 ** (attempt - 1));
	return base + Math.floor(Math.random() * 250);
}

function retryDelay(response: HttpResponse, attempt: number): number {
	const retryAfter = Number(response.headers['retry-after']);
	if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(60_000, retryAfter * 1000);
	const reset = Number(response.headers['ratelimit-reset']);
	if (Number.isFinite(reset) && reset > 0) {
		const wait = reset * 1000 - Date.now();
		if (wait > 0) return Math.min(60_000, wait);
	}
	return backoff(attempt);
}

function toError(response: HttpResponse): GitLabError {
	const detail = errorMessage(response.text);
	switch (response.status) {
		case 401: return new GitLabError('unauthorized', 'GitLab rejected the token. It may be wrong, expired or revoked.', 401);
		case 403: return new GitLabError('forbidden', `Your token isn't allowed to do this.${detail ? ` ${detail}` : ''}`, 403);
		case 404: return new GitLabError('not-found', `Not found on GitLab.${detail ? ` ${detail}` : ''}`, 404);
		case 429: return new GitLabError('rate-limited', 'GitLab is rate-limiting requests. Try again in a minute.', 429);
		default:
			if (response.status >= 500) return new GitLabError('server', `GitLab had a problem (${response.status}). Try again shortly.`, response.status);
			return new GitLabError('rejected', detail || `GitLab refused the request (${response.status}).`, response.status);
	}
}

function errorMessage(text: string): string {
	try {
		const body = JSON.parse(text) as { message?: unknown; error?: unknown; error_description?: unknown };
		const value = body.message ?? body.error_description ?? body.error;
		if (typeof value === 'string') return value;
		if (value && typeof value === 'object') return JSON.stringify(value);
	} catch {
		// Not JSON; fall through.
	}
	return '';
}
