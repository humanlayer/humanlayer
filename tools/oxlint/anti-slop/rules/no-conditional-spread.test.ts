import { RuleTester } from 'oxlint/plugins-dev'

import { noConditionalSpreadRule } from './no-conditional-spread.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'tsx' } } })
const error = { messageId: 'avoid' }

tester.run('anti-slop/no-conditional-spread', noConditionalSpreadRule, {
	valid: ['const value = { ...base };', 'const value = [...items];', 'fn(...args);'],
	invalid: [
		{ code: 'const value = { ...(condition ? left : right) };', errors: [error] },
		{ code: 'const value = { ...(!condition ? undefined : fields) };', errors: [error] },
		{ code: 'const value = { ...(condition && { key: value }) };', errors: [error] },
		{ code: 'const value = { ...(maybeValue ?? {}) };', errors: [error] },
		{ code: 'const value = { ...(maybeValue || {}) };', errors: [error] },
		{ code: 'const value = [...(condition ? items : [])];', errors: [error] },
		{ code: 'const value = [...(maybeItems ?? [])];', errors: [error] },
		{ code: 'fn(...(condition ? args : []));', errors: [error] },
		{ code: 'const value = { ...((condition && fields)) };', errors: [error] },
		{ code: 'const element = <Component {...(condition ? props : {})} />;', errors: [error] },
		{ code: 'const element = <Component {...(condition && props)} />;', errors: [error] },
		{ code: 'const element = <Component {...(maybeProps ?? {})} />;', errors: [error] },
	],
})
