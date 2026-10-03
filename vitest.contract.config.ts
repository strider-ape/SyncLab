import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/contract/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
	},
});
