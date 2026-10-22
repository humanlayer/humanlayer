import { fileURLToPath, URL } from 'node:url'

import { dom } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	dom,
	defineConfig({
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
			},
		},
		test: {
			pool: 'forks',
			testTimeout: 15_000,
			include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
		},
	}),
)
