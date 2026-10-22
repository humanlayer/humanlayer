import { RuleTester } from 'oxlint/plugins-dev'

import { noObjectParametersRule } from './no-object-parameters.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const error = { messageId: 'objectParameter' }

tester.run('anti-slop/no-object-parameters', noObjectParametersRule, {
	valid: [
		'type Alias = object;',
		'function f(value: Alias) {}',
		'interface Owner { readonly id: string } function f(value: Owner) {}',
		'function f<Value>(value: Value) {}',
		'function f<Value extends object>(value: Value) {}',
		'type Alias = object; function consume<Alias>(value: Alias) {}',
	],
	invalid: [
		{ code: 'function f(value: object) {}', errors: [error] },
		{ code: 'type Alias = object; function f(value: Alias) {}', errors: [error] },
	],
})
