import esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { builtinModules } from 'node:module';
import { buildCss, watchCss } from './scripts/build-css.mjs';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: production ? false : 'inline',
	treeShaking: true,
	minify: production,
	outfile: 'main.js',
	mainFields: ['svelte', 'browser', 'module', 'main'],
	conditions: ['svelte', 'browser'],
	plugins: [sveltePlugin({ compilerOptions: { css: 'external', dev: !production } })],
});

await buildCss();

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	watchCss();
	await context.watch();
}
