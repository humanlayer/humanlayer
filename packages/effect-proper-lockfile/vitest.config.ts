import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		// The cross-process contention tests spawn real child processes; on a loaded CI
		// runner (turbo runs ~28 packages concurrently) they legitimately exceed vitest's
		// 5s default and die with exit 130.
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
})
