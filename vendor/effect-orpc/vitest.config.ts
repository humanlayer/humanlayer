import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		pool: 'forks',
		testTimeout: 15_000,
		include: ['src/tests/**/*.test.ts'],
	},
})
