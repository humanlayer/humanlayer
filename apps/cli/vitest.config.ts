import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			include: ['test/**/*.test.ts'],
		},
	}),
)
