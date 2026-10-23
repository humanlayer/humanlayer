import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

type Diagnostic = { readonly code: string; readonly filename: string }
type OxlintOutput = { readonly diagnostics: ReadonlyArray<Diagnostic> }

const runRules = (...files: ReadonlyArray<string>): ReadonlyArray<Diagnostic> => {
	const result = spawnSync(
		'./node_modules/.bin/oxlint',
		[
			'--config',
			'tools/oxlint/automation/test-config.jsonc',
			'--format',
			'json',
			'--no-ignore',
			...files,
		],
		{ encoding: 'utf8' },
	)
	const output = result.stdout
	if (output.length === 0) throw new Error(result.stderr)
	return (JSON.parse(output) as OxlintOutput).diagnostics
}

describe('tagged value OXLint rules', () => {
	it('reports comparisons, broad error discrimination, and manual construction', () => {
		const diagnostics = runRules('tools/oxlint/automation/test-fixtures/invalid.ts')
		expect(diagnostics.map(({ code }) => code).sort()).toEqual([
			'automation(no-manual-effect-error-tag)',
			'automation(no-manual-effect-error-tag)',
			'automation(no-manual-effect-error-tag)',
			'automation(no-manual-tag-comparison)',
			'automation(no-manual-tag-comparison)',
			'automation(no-manual-tagged-construction)',
		].sort())
	})

	it('allows Effect helpers, Match patterns, constructors, and type nodes', () => {
		expect(runRules('tools/oxlint/automation/test-fixtures/valid.ts')).toEqual([])
	})
})
