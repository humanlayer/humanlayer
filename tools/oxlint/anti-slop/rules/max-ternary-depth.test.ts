import { RuleTester } from 'oxlint/plugins-dev'

import { maxTernaryDepthRule } from './max-ternary-depth.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })

tester.run('anti-slop/max-ternary-depth', maxTernaryDepthRule, {
	valid: [
		'const value = condition ? left : right;',
		'const value = first ? one : second ? two : fallback;',
		{
			code: 'const value = first ? one : second ? two : third ? three : fallback;',
			options: [{ maxDepth: 3 }],
		},
	],
	invalid: [
		{
			code: 'const value = first ? one : second ? two : third ? three : fallback;',
			errors: [{ messageId: 'exceeded', data: { depth: 3, maxDepth: 2 } }],
		},
		{
			code: 'const value = first ? (second ? (third ? three : other) : two) : fallback;',
			errors: [{ messageId: 'exceeded', data: { depth: 3, maxDepth: 2 } }],
		},
		{
			code: 'const value = first ? ((second ? two : third ? three : fallback) as string) : other;',
			errors: [{ messageId: 'exceeded', data: { depth: 3, maxDepth: 2 } }],
		},
		{
			code: 'const value = first ? (second ? two : third ? three : fallback)! : other;',
			errors: [{ messageId: 'exceeded', data: { depth: 3, maxDepth: 2 } }],
		},
		{
			code: 'const value = first ? one : second ? two : fallback;',
			options: [{ maxDepth: 1 }],
			errors: [{ messageId: 'exceeded', data: { depth: 2, maxDepth: 1 } }],
		},
	],
})
