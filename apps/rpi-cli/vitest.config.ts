import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		pool: 'forks',
		testTimeout: 15_000,
		projects: [
			{ extends: true, test: { name: 'unit', include: ['src/test/config-resolution.test.ts'] } },
			{ extends: true, test: { name: 'e2e', include: ['src/test/e2e/**/*.test.ts'], testTimeout: 60_000 } },
			{
				extends: true,
				test: { name: 'learning', include: ['src/test/learning/**/*.test.ts'], testTimeout: 60_000 },
			},
		],
	},
})
