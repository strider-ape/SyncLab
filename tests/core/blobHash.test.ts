import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gitBlobId, sha1 } from '../../src/core/blobHash';

function gitHashObject(bytes: Uint8Array): string {
	return execFileSync('git', ['hash-object', '--no-filters', '--stdin'], { input: bytes }).toString().trim();
}

const samples: Record<string, Uint8Array> = {
	empty: new Uint8Array(),
	'text with newline': new TextEncoder().encode('hello\n'),
	'CRLF line endings': new TextEncoder().encode('line one\r\nline two\r\n'),
	'UTF-8 BOM': new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# Title\n')]),
	'non-ASCII text': new TextEncoder().encode('Grüße, नमस्ते, 你好 🚀\n'),
	'binary with NUL bytes': Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256),
	'1 MB of data': Uint8Array.from({ length: 1024 * 1024 }, (_, i) => (i * 31) % 251),
};

describe('gitBlobId', () => {
	it('matches the well-known id of an empty blob', async () => {
		expect(await gitBlobId(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	});

	for (const [name, bytes] of Object.entries(samples)) {
		it(`matches git hash-object for ${name}`, async () => {
			expect(await gitBlobId(bytes)).toBe(gitHashObject(bytes));
		});
	}

	it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
		const bytes = new TextEncoder().encode('same bytes');
		expect(await gitBlobId(bytes.buffer)).toBe(await gitBlobId(bytes));
	});
});

describe('sha1 fallback', () => {
	it('agrees with Web Crypto on every sample', async () => {
		for (const bytes of Object.values(samples)) {
			const expected = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array(bytes)));
			expect(sha1(bytes)).toEqual(expected);
		}
	});
});
