import { closeSync, existsSync, openSync, readdirSync, readSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Copies Obsidian's own app.css out of the locally installed app bundle, so the
 * browser preview renders SyncLab on top of Obsidian's real base styles and
 * catches clashes with them. The file stays in the git-ignored preview build
 * folder: it's Obsidian's code and is never committed or shipped.
 *
 * Returns the app version used, or null when no Obsidian install is found.
 */
export function extractObsidianCss(outFile) {
	const bundle = findBundle();
	if (!bundle) return null;

	const fd = openSync(bundle.path, 'r');
	try {
		// asar layout: [pickle: u32 4, u32 headerSize][header pickle: u32 payload, u32 jsonLength, json][files…]
		const prefix = Buffer.alloc(8);
		readSync(fd, prefix, 0, 8, 0);
		const headerSize = prefix.readUInt32LE(4);
		const headerBuffer = Buffer.alloc(headerSize);
		readSync(fd, headerBuffer, 0, headerSize, 8);
		const header = JSON.parse(headerBuffer.toString('utf8', 8, 8 + headerBuffer.readUInt32LE(4)));
		const entry = header.files?.['app.css'];
		if (!entry) return null;
		const css = Buffer.alloc(entry.size);
		readSync(fd, css, 0, entry.size, 8 + headerSize + Number(entry.offset));
		writeFileSync(outFile, css);
		return bundle.version;
	} finally {
		closeSync(fd);
	}
}

function findBundle() {
	const configDirs = [
		process.env.APPDATA && join(process.env.APPDATA, 'obsidian'),
		join(homedir(), 'Library', 'Application Support', 'obsidian'),
		join(homedir(), '.config', 'obsidian'),
	].filter(Boolean);

	const bundles = [];
	for (const dir of configDirs) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const match = /^obsidian-(\d+)\.(\d+)\.(\d+)\.asar$/.exec(name);
			if (match) bundles.push({ path: join(dir, name), version: match.slice(1).join('.'), key: match.slice(1).map(Number) });
		}
	}
	bundles.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);
	return bundles[0] ?? null;
}
