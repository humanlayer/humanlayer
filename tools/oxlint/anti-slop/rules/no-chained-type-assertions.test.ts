import { RuleTester } from 'oxlint/plugins-dev'

import { noChainedTypeAssertionsRule } from './no-chained-type-assertions.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'chained' }

tester.run('anti-slop/no-chained-type-assertions', noChainedTypeAssertionsRule, {
	valid: ['const value = input as User;', "const value = { name: 'Ada' } as const;", 'const value = input;'],
	invalid: [
		{
			code: 'const value = input as unknown as User;',
			errors: [error],
		},
		{
			code: 'const value = (input as unknown) as User;',
			errors: [error],
		},
		{
			code: 'const value = <User><unknown>input;',
			errors: [error],
		},
	],
})
