import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		pool: 'forks',
		testTimeout: 15_000,
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					include: ['test/**/*.test.ts'],
					exclude: ['test/**/*.integration.test.ts', 'test/**/*.learning.test.ts'],
				},
			},
			{
				extends: true,
				test: { name: 'integration', include: ['test/**/*.integration.test.ts'], testTimeout: 30_000 },
			},
			{ extends: true, test: { name: 'learning', include: ['test/**/*.learning.test.ts'], testTimeout: 60_000 } },
		],
	},
})
