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
					include: ['tests/**/*.test.ts', 'src/**/*.vi.test.ts'],
					exclude: [
						'src/test/learning/**',
						'eval/**',
						'tests/context7-api.test.ts',
						'tests/doc-researcher.test.ts',
						'tests/exa-context-api.test.ts',
					],
					testTimeout: 30_000,
				},
			},
			{
				extends: true,
				test: {
					name: 'learning',
					include: ['src/test/learning/**/*.test.ts'],
					testTimeout: 60_000,
				},
			},
			{
				extends: true,
				test: {
					name: 'eval',
					include: ['eval/**/*.test.ts'],
					testTimeout: 1_800_000,
				},
			},
		],
	},
})
