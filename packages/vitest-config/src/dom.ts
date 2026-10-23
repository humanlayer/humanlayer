import { fileURLToPath } from 'node:url'

import { defineConfig, mergeConfig } from 'vitest/config'

import { base } from './base.ts'

/**
 * Shared DOM Vitest config for packages with React component tests.
 *
 * Extends {@link base} with:
 * - `environment: 'happy-dom'` — consumers must declare `happy-dom` in their own
 *   devDependencies (Vitest resolves the environment package from the consuming
 *   project; the isolated linker does not expose transitive deps). Packages that
 *   prefer jsdom can override `test.environment` after merging.
 * - a setup file that registers `@testing-library/jest-dom/vitest` matchers and
 *   runs React Testing Library's `cleanup` after each test. The explicit
 *   `afterEach(cleanup)` is mandatory: RTL auto-cleanup only activates when a
 *   global `afterEach` exists, which never happens with `globals: false`.
 */
export const dom = mergeConfig(
	base,
	defineConfig({
		test: {
			environment: 'happy-dom',
			setupFiles: [fileURLToPath(new URL('./setup.dom.ts', import.meta.url))],
		},
	}),
)
