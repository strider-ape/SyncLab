import { copyFileSync, mkdirSync } from 'node:fs';
import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { buildCss } from './build-css.mjs';
import { extractObsidianCss } from './obsidian-css.mjs';

// Builds the browser preview into dev/preview/build. Serve dev/preview with any static server.
mkdirSync('dev/preview/build', { recursive: true });
await buildCss();
copyFileSync('styles.css', 'dev/preview/build/styles.css');
const obsidianVersion = extractObsidianCss('dev/preview/build/obsidian-app.css');
process.stdout.write(obsidianVersion
	? `Using Obsidian ${obsidianVersion}'s app.css for the preview.\n`
	: 'Obsidian not found: the preview runs without its base styles.\n');
await esbuild.build({
	entryPoints: ['dev/preview/main.ts'],
	bundle: true,
	format: 'esm',
	target: 'es2022',
	outfile: 'dev/preview/build/preview.js',
	alias: { obsidian: './dev/preview/obsidian-stub.ts' },
	mainFields: ['svelte', 'browser', 'module', 'main'],
	conditions: ['svelte', 'browser'],
	plugins: [sveltePlugin({ compilerOptions: { css: 'external', dev: true } })],
	logLevel: 'info',
});
