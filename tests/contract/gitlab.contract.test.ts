/**
 * Contract tests against a real GitLab project (milestone M0). They pin down
 * the API behaviour the sync engine relies on. Opt-in: create `.env.local`
 * (git-ignored) with
 *
 *   SYNCLAB_GITLAB_URL=https://gitlab.com
 *   SYNCLAB_GITLAB_TOKEN=glpat-…      (api scope)
 *   SYNCLAB_GITLAB_PROJECT=12345678   (a throwaway project)
 *
 * then run `npm run test:contract`. Everything happens on a temporary branch
 * that is deleted afterwards.
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitBlobId } from '../../src/core/blobHash';
import { toBase64 } from '../../src/engine/base64';
import { GitLabClient, GitLabError } from '../../src/gitlab/GitLabClient';
import { GitLabRepo } from '../../src/gitlab/GitLabRepo';
import { lowercaseHeaders, type HttpFn } from '../../src/gitlab/http';

function loadEnv(): Record<string, string> {
	const env: Record<string, string> = { ...process.env } as Record<string, string>;
	if (existsSync('.env.local')) {
		for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
			const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
			if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2];
		}
	}
	return env;
}

const env = loadEnv();
const url = env.SYNCLAB_GITLAB_URL ?? '';
const token = env.SYNCLAB_GITLAB_TOKEN ?? '';
const projectId = Number(env.SYNCLAB_GITLAB_PROJECT ?? '');
const configured = Boolean(url && token && projectId);

const nodeHttp: HttpFn = async request => {
	const response = await fetch(request.url, {
		method: request.method,
		headers: request.body === undefined ? request.headers : { ...request.headers, 'Content-Type': 'application/json' },
		body: request.body,
	});
	const arrayBuffer = request.method === 'HEAD' ? new ArrayBuffer(0) : await response.arrayBuffer();
	const headers: Record<string, string> = {};
	response.headers.forEach((value, name) => { headers[name] = value; });
	return { status: response.status, headers: lowercaseHeaders(headers), arrayBuffer, text: new TextDecoder().decode(arrayBuffer) };
};

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${url.replace(/\/+$/, '')}/api/v4${path}`, {
		method,
		headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
	return response.status === 204 ? null : response.json();
}

const enc = (text: string) => new TextEncoder().encode(text);
const branch = `synclab-contract-${Date.now()}`;

describe.skipIf(!configured)('GitLab API contract', () => {
	const client = new GitLabClient({ baseUrl: url, token, http: nodeHttp, sleep: ms => new Promise(r => setTimeout(r, ms)) });
	const repo = new GitLabRepo(client, projectId, branch);
	const files = {
		'contract/crlf.md': enc('one\r\ntwo\r\n'),
		'contract/bom.md': new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# BOM\n')]),
		'contract/binary.bin': Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 256),
		'contract/unicode name ü.md': enc('Grüße\n'),
	};

	beforeAll(async () => {
		const project = await client.getProject(projectId);
		await api('POST', `/projects/${projectId}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(project.default_branch ?? 'main')}`);
	});

	afterAll(async () => {
		await api('DELETE', `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`).catch(() => undefined);
	});

	it('creates files atomically and reports blob ids equal to git blob ids of the raw bytes', async () => {
		await repo.commit('contract: create', Object.entries(files).map(([path, data]) => ({
			action: 'create', file_path: path, content: toBase64(data.slice().buffer), encoding: 'base64',
		})));
		const head = await repo.head();
		const tree = await repo.tree(head as string);
		for (const [path, data] of Object.entries(files)) {
			expect(tree.get(path), path).toBe(await gitBlobId(data));
		}
	});

	it('downloads blobs byte for byte', async () => {
		const blob = await gitBlobId(files['contract/binary.bin']);
		expect(new Uint8Array(await repo.blob(blob))).toEqual(files['contract/binary.bin']);
	});

	it('returns blob id and last commit id from a HEAD request', async () => {
		const head = await repo.head() as string;
		const info = await repo.fileInfo('contract/crlf.md', head);
		expect(info?.blobId).toBe(await gitBlobId(files['contract/crlf.md']));
		expect(info?.lastCommitId).toMatch(/^[0-9a-f]{40}$/);
		expect(await repo.fileInfo('contract/missing.md', head)).toBeNull();
	});

	it('rejects an update whose last_commit_id is stale', async () => {
		const head = await repo.head() as string;
		const stale = (await repo.fileInfo('contract/crlf.md', head))?.lastCommitId;
		await repo.commit('contract: someone else edits', [{ action: 'update', file_path: 'contract/crlf.md', content: toBase64(enc('changed\n').slice().buffer), encoding: 'base64' }]);
		const attempt = repo.commit('contract: stale update', [{ action: 'update', file_path: 'contract/crlf.md', content: toBase64(enc('mine\n').slice().buffer), encoding: 'base64', last_commit_id: stale }]);
		await expect(attempt).rejects.toSatisfy(error => error instanceof GitLabError && error.kind === 'rejected');
	});

	it('rejects a stale delete', async () => {
		const head = await repo.head() as string;
		const stale = (await repo.fileInfo('contract/bom.md', head))?.lastCommitId;
		await repo.commit('contract: touch bom', [{ action: 'update', file_path: 'contract/bom.md', content: toBase64(enc('new\n').slice().buffer), encoding: 'base64' }]);
		const attempt = repo.commit('contract: stale delete', [{ action: 'delete', file_path: 'contract/bom.md', last_commit_id: stale }]);
		await expect(attempt).rejects.toSatisfy(error => error instanceof GitLabError && error.kind === 'rejected');
	});

	it('rejects creating a file that already exists', async () => {
		const attempt = repo.commit('contract: duplicate create', [{ action: 'create', file_path: 'contract/crlf.md', content: toBase64(enc('x').slice().buffer), encoding: 'base64' }]);
		await expect(attempt).rejects.toSatisfy(error => error instanceof GitLabError && error.kind === 'rejected');
	});

	it('moves a file without resending its content', async () => {
		const head = await repo.head() as string;
		const info = await repo.fileInfo('contract/binary.bin', head);
		await repo.commit('contract: move', [{ action: 'move', previous_path: 'contract/binary.bin', file_path: 'contract/moved/binary.bin', last_commit_id: info?.lastCommitId }]);
		const tree = await repo.tree(await repo.head() as string);
		expect(tree.has('contract/binary.bin')).toBe(false);
		expect(tree.get('contract/moved/binary.bin')).toBe(await gitBlobId(files['contract/binary.bin']));
	});

	it('follows keyset pagination past 100 tree entries', async () => {
		const actions = Array.from({ length: 130 }, (_, i) => ({
			action: 'create' as const, file_path: `contract/many/${String(i).padStart(3, '0')}.md`, content: toBase64(enc(`${i}\n`).slice().buffer), encoding: 'base64' as const,
		}));
		await repo.commit('contract: many files', actions);
		const tree = await repo.tree(await repo.head() as string);
		expect([...tree.keys()].filter(path => path.startsWith('contract/many/'))).toHaveLength(130);
	});
}, 120_000);
