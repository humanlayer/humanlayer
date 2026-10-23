import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			include: ['test/effect/resend-service.live.vi.ts'],
			testTimeout: 30_000,
			fileParallelism: false,
		},
	}),
)
