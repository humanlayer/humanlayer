import { describe, expect, it } from 'vitest'

import { changedPaths, needsRustCheck } from './rust-check-inputs.mjs'

describe('Rust check inputs', () => {
	it.each([
		'apps/riptide-native/src/lib.rs',
		'packages/schemas/test/fixtures/daemon-process-events.jsonl',
		'packages/new-crate/src/lib.rs',
		'apps/example/.cargo/config.json',
		'.github/workflows/ci.yml',
		'.cargo/config.toml',
		'Cargo.lock',
		'rust-toolchain.toml',
		'package.json',
		'bun.lock',
		'scripts/new-build-input.ts',
		'unknown/input',
	])('runs for relevant or uncertain input %s', (path) => {
		expect(needsRustCheck([path])).toBe(true)
	})
	it('skips known unrelated source inputs only', () => {
		expect(
			needsRustCheck([
				'apps/riptide-ui/src/main.tsx',
				'apps/riptide-daemon/src/index.ts',
				'apps/riptide-cloud/src/index.tsx',
				'packages/ui/src/button.tsx',
				'contracts/riptide-api-contract/src/index.ts',
			]),
		).toBe(false)
	})
	it('evaluates both paths of a rename and deleted external fixtures', () => {
		expect(
			needsRustCheck(
				changedPaths('packages/schemas/test/fixtures/daemon-process-events.jsonl\0packages/ui/fixture.json\0'),
			),
		).toBe(true)
	})
	it('fails closed on missing or truncated input', () => {
		expect(needsRustCheck([])).toBe(true)
		expect(() => changedPaths('')).toThrow()
		expect(() => changedPaths('apps/example/index.ts')).toThrow()
	})
	it('emits fail-closed workflow output when SHAs are invalid or unavailable', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rust-inputs-'))
		try {
			for (const sha of ['invalid', '0'.repeat(40)]) {
				const output = join(dir, 'output')
				writeFileSync(output, '')
				execFileSync('node', [fileURLToPath(new URL('./rust-check-inputs.mjs', import.meta.url))], {
					cwd: dir,
					env: { ...process.env, PR_BASE_SHA: sha, PR_HEAD_SHA: sha, GITHUB_OUTPUT: output },
					stdio: 'pipe',
				})
				expect(readFileSync(output, 'utf8')).toBe('required=true\n')
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
