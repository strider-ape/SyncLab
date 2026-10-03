import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
	globalIgnores(['node_modules/', 'main.js', 'styles.css', 'docs/', 'dev/', '**/*.svelte']),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mjs', 'esbuild.config.mjs', 'version-bump.mjs', 'scripts/*.mjs', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', { brands: ['SyncLab', 'GitLab', 'GitLab.com', 'Obsidian'], acronyms: ['API', 'URL', 'MB'] }],
		},
	},
	{
		// The core is pure: no Obsidian, no network, no engine.
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', {
				patterns: [
					{ group: ['obsidian'], message: 'src/core must not depend on Obsidian.' },
					{ group: ['../engine/*', '../gitlab/*', '../ui/*', '../obsidian/*'], message: 'src/core must not depend on other layers.' },
				],
			}],
		},
	},
	{
		// The engine talks to the outside world only through its ports.
		files: ['src/engine/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', {
				patterns: [
					{ group: ['obsidian'], message: 'The engine must stay testable without Obsidian; use a port.' },
					{ group: ['../ui/*', '../obsidian/*'], message: 'The engine must not depend on UI or Obsidian adapters.' },
				],
			}],
		},
	},
	{
		// Build scripts and tests run in Node, never inside Obsidian.
		files: ['tests/**/*.ts', 'scripts/**/*.mjs', '*.mjs', 'vitest.config.ts'],
		languageOptions: { globals: { ...globals.node } },
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'no-restricted-globals': 'off',
		},
	},
);
