import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Third-party code that ships inside SyncLab's release files. Their licenses ask
// for their notices to travel with the files, so the build puts them at the top
// of main.js and styles.css, and THIRD-PARTY-NOTICES.md lists them in the repo.
export const IN_MAIN_JS = [
	{ name: 'svelte', use: 'UI framework (compiled into main.js)' },
	{ name: 'esm-env', use: 'Used by Svelte (compiled into main.js)' },
	{ name: 'ignore', use: '.gitignore-style ignore patterns (compiled into main.js)' },
	{ name: 'diff', use: 'Line-by-line compare view (compiled into main.js)' },
];
export const IN_STYLES_CSS = [
	{ name: '@fontsource-variable/lexend', use: 'Lexend typeface (embedded in styles.css)' },
];

function read(name) {
	const dir = join('node_modules', name);
	const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
	const file = readdirSync(dir).find(f => /^licen[cs]e/i.test(f));
	if (!file) throw new Error(`No license file in ${name}`);
	return { version: pkg.version, license: pkg.license, text: readFileSync(join(dir, file), 'utf8').trim() };
}

/** A /*! *\/ comment block with each package's license, safe to put at the top of a JS or CSS file. */
export function noticeComment(entries) {
	const body = entries.map(({ name }) => {
		const { version, license, text } = read(name);
		return `${name} ${version} (${license})\n\n${text}`;
	}).join('\n\n----------------------------------------\n\n');
	const safe = `SyncLab is in the public domain (The Unlicense): https://github.com/strider-ape/SyncLab\nIt includes the following open source work, under its own license:\n\n${body}`.replace(/\*\//g, '* /');
	return `/*!\n${safe}\n*/`;
}

export function writeNoticesFile() {
	const sections = [...IN_MAIN_JS, ...IN_STYLES_CSS].map(({ name, use }) => {
		const { version, license, text } = read(name);
		return `## ${name} ${version}\n\n${use}. License: ${license}.\n\n\`\`\`\n${text}\n\`\`\``;
	});
	writeFileSync('THIRD-PARTY-NOTICES.md', `# Third-party notices

SyncLab's own code is in the public domain (see LICENSE). The release files
also contain the open source work below, which keeps its own license. These
notices travel with SyncLab as those licenses ask, and the build also puts
them at the top of main.js and styles.css.

${sections.join('\n\n')}
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeNoticesFile();
	process.stdout.write('Wrote THIRD-PARTY-NOTICES.md\n');
}
