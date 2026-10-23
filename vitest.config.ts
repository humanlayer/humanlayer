import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		pool: 'forks',
		testTimeout: 15_000,
		include: ['ci-scripts/**/*.test.ts', 'src/test/**/*.test.ts'],
	},
})
