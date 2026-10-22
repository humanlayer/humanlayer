import { base, projects } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			projects: projects({
				unit: {
					include: ['src/**/*.test.ts'],
					exclude: ['src/test/learning/**'],
					testTimeout: 120_000,
				},
				learning: {
					include: ['src/test/learning/**/*.test.ts'],
				},
			}),
		},
	}),
)
