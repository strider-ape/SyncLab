import type { BlobId } from './types';

/**
 * Git blob id of raw bytes: SHA-1 over `blob <size>\0<bytes>`.
 * Matches the ids GitLab reports in repository trees, so local and remote
 * files can be compared without downloading anything.
 */
export async function gitBlobId(content: ArrayBuffer | Uint8Array): Promise<BlobId> {
	const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
	const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
	const data = new Uint8Array(header.byteLength + bytes.byteLength);
	data.set(header, 0);
	data.set(bytes, header.byteLength);

	const subtle = typeof crypto === 'undefined' ? undefined : crypto.subtle;
	if (subtle) {
		return toHex(new Uint8Array(await subtle.digest('SHA-1', data)));
	}
	return toHex(sha1(data));
}

function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

/** Fallback SHA-1 for runtimes without Web Crypto. */
export function sha1(message: Uint8Array): Uint8Array {
	const bitLength = message.byteLength * 8;
	const paddedLength = (((message.byteLength + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(message);
	padded[message.byteLength] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
	view.setUint32(paddedLength - 4, bitLength >>> 0);

	let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
	const w = new Uint32Array(80);
	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
		for (let i = 16; i < 80; i++) {
			const x = (w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0);
			w[i] = (x << 1) | (x >>> 31);
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4;
		for (let i = 0; i < 80; i++) {
			let f: number, k: number;
			if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
			else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
			else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
			else { f = b ^ c ^ d; k = 0xca62c1d6; }
			const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[i] ?? 0)) >>> 0;
			e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
		}
		h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
	}

	const out = new Uint8Array(20);
	const outView = new DataView(out.buffer);
	[h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
	return out;
}
