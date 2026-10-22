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
					include: ['src/**/*.test.ts'],
					exclude: ['src/test/integration/**', 'src/test/learning/**'],
				},
			},
			{
				extends: true,
				test: { name: 'integration', include: ['src/test/integration/**/*.test.ts'], testTimeout: 60_000 },
			},
			{
				extends: true,
				test: { name: 'learning', include: ['src/test/learning/**/*.test.ts'], testTimeout: 60_000 },
			},
		],
	},
})
