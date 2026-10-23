import { describe, expect, it } from 'vitest'

/**
 * Permanent guard: Vitest suites must run on the Node runtime, never Bun.
 *
 * If this test fails, something reintroduced `--bun` into the test invocation
 * chain (root `test:ci`, a package's test script, or CI). `bun --bun` shims
 * `node` to the Bun runtime for the entire process tree, so Vitest's
 * `#!/usr/bin/env node` shebang silently resolves to Bun again.
 */
describe('runtime canary', () => {
	it('runs Vitest under Node, not Bun', () => {
		expect(typeof Bun).toBe('undefined')
	})
})
