import { eslintCompatPlugin } from '@oxlint/plugins'

import { maxTernaryDepthRule } from './rules/max-ternary-depth.ts'
import { noChainedTypeAssertionsRule } from './rules/no-chained-type-assertions.ts'
import { noConditionalSpreadRule } from './rules/no-conditional-spread.ts'
import { noKnownValueWideningRule } from './rules/no-known-value-widening.ts'
import { noObjectParametersRule } from './rules/no-object-parameters.ts'
import { noReprovideAmbientServiceRule } from './rules/no-reprovide-ambient-service.ts'
import { noUnknownTypeAliasesRule } from './rules/no-unknown-type-aliases.ts'
import { noWidenThenAssertRule } from './rules/no-widen-then-assert.ts'

const antiSlopPlugin = eslintCompatPlugin({
	meta: { name: 'anti-slop' },
	rules: {
		'max-ternary-depth': maxTernaryDepthRule,
		'no-chained-type-assertions': noChainedTypeAssertionsRule,
		'no-conditional-spread': noConditionalSpreadRule,
		'no-known-value-widening': noKnownValueWideningRule,
		'no-object-parameters': noObjectParametersRule,
		'no-reprovide-ambient-service': noReprovideAmbientServiceRule,
		'no-unknown-type-aliases': noUnknownTypeAliasesRule,
		'no-widen-then-assert': noWidenThenAssertRule,
	},
})

export default antiSlopPlugin
