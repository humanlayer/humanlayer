import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			fileParallelism: false,
			include: ['test/**/*.test.ts'],
			maxWorkers: 1,
			testTimeout: 60_000,
		},
	}),
)
