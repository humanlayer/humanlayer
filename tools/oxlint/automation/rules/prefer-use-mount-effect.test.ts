import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { RuleTester } from 'oxlint/plugins-dev'

import { preferUseMountEffectRule } from './prefer-use-mount-effect.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'tsx' } } })
const ruleName = 'automation/prefer-use-mount-effect'
const code = 'import { useEffect } from "react"; useEffect(() => {}, []);'

tester.run(ruleName, preferUseMountEffectRule, {
	valid: [
		...[
			'',
			', undefined',
			', null',
			', [value]',
			', deps',
			', [...deps]',
			', [,]',
			', [] as const',
			', [], extra',
		].map((args) => `import { useEffect } from "react"; useEffect(callback${args});`),
		'import { useEffect } from "other"; useEffect(callback, []);',
		'import React from "other"; React.useEffect(callback, []);',
		'function useEffect() {} useEffect(callback, []);',
		'const React = { useEffect() {} }; React.useEffect(callback, []);',
		'import { useEffect } from "react"; function f(useEffect) { useEffect(callback, []); }',
		'import React from "react"; function f(React) { React.useEffect(callback, []); }',
		'import { useEffect as effect } from "react"; function f() { const effect = local; effect(callback, []); }',
		'import React from "react"; React[useEffect](callback, []);',
		'import React from "react"; React.useLayoutEffect(callback, []);',
		'import { useLayoutEffect as useEffect } from "react"; useEffect(callback, []);',
		'import type { useEffect } from "react"; useEffect(callback, []);',
		'import { type useEffect } from "react"; useEffect(callback, []);',
		'import type React from "react"; React.useEffect(callback, []);',
		'import type * as React from "react"; React.useEffect(callback, []);',
		'import { type default as React } from "react"; React.useEffect(callback, []);',
		'import { useMountEffect } from "@/hooks/useMountEffect"; useMountEffect(callback);',
		'useEffect(callback, []); React.useEffect(callback, []);',
	],
	invalid: [
		code,
		'import { useEffect as effect } from "react"; effect(callback, []);',
		'import React from "react"; React.useEffect(callback, []);',
		'import * as R from "react"; R.useEffect(callback, []);',
		'import { default as R } from "react"; R["useEffect"](callback, []);',
		'import * as R from "react"; R["useEffect"](callback, []);',
		'import { useEffect } from "react"; useEffect(callback, ([]));',
		'import { useEffect } from "react"; function C() { useEffect(() => () => cleanup(), []); return <div />; }',
	].map((code) => ({ code, errors: [{ messageId: 'preferMount' }], output: null })),
})

// Reuse the same tester/rule across files, including a helper-looking filename.
tester.run(ruleName, preferUseMountEffectRule, {
	valid: [{ filename: 'unrelated.tsx', code: 'useEffect(callback, []);' }],
	invalid: [
		{
			filename: 'useMountEffect.ts',
			code: `${code} useEffect(callback, []);`,
			errors: [{ messageId: 'preferMount' }, { messageId: 'preferMount' }],
			output: null,
		},
	],
})

// Exercise the root registration/severity and its exact overrides through the CLI.
const cli = resolve('node_modules/.bin/oxlint')
const printed = spawnSync(
	'bun',
	['-e', 'console.log(JSON.stringify(Bun.JSONC.parse(await Bun.file(".oxlintrc.jsonc").text())))'],
	{ encoding: 'utf8' },
)
assert.equal(printed.status, 0, printed.stderr)
const root = JSON.parse(printed.stdout)
assert.equal(root.rules[ruleName], 'error')
const overrides = root.overrides.filter((override: { rules: Record<string, unknown> }) => ruleName in override.rules)
const helpers = [
	'apps/riptide-ui/src/hooks/useMountEffect.ts',
	'apps/riptide-cloud/src/hooks/useMountEffect.ts',
	'packages/ui/src/hooks/use-mount-effect.ts',
]
assert.deepEqual(overrides, [{ files: helpers, rules: { [ruleName]: 'off' } }])
const directory = mkdtempSync(join(tmpdir(), 'mount-effect-rule-'))
try {
	const consumers = helpers.map((file) => file.replace('/hooks/', '/consumer/'))
	for (const file of [...helpers, ...consumers]) {
		const path = join(directory, file)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, code)
	}
	const plugin = root.jsPlugins.find((plugin: { name: string }) => plugin.name === 'automation')
	assert.ok(plugin)
	writeFileSync(
		join(directory, '.oxlintrc.json'),
		JSON.stringify({
			categories: { correctness: 'off' },
			jsPlugins: [{ ...plugin, specifier: resolve(plugin.specifier) }],
			rules: { [ruleName]: root.rules[ruleName] },
			overrides,
		}),
	)
	const result = spawnSync(cli, ['--format', 'json', '.'], { cwd: directory, encoding: 'utf8' })
	assert.equal(result.status, 1, result.stderr)
	const diagnostics = JSON.parse(result.stdout).diagnostics
	assert.deepEqual(diagnostics.map((d: { filename: string }) => d.filename).sort(), consumers.sort())
	for (const diagnostic of diagnostics) {
		assert.equal(diagnostic.code, 'automation(prefer-use-mount-effect)')
		assert.equal(diagnostic.severity, 'error')
	}
} finally {
	rmSync(directory, { recursive: true, force: true })
}
