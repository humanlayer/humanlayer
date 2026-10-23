import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			// Every behavioral test here drives REAL git (init, commit, hooks) in a temp repo, and
			// a git spawn on the Windows runner costs roughly ten times what it does on Linux/macOS
			// — a test making a handful of commits lands near a minute there while finishing in
			// about a second locally. The shared 15s default therefore fails on Windows for
			// timing, not for behavior; this bounds the slow platform generously and still catches
			// a genuinely hung git.
			testTimeout: 120_000,
		},
	}),
)
