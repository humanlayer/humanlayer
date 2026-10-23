import { eslintCompatPlugin } from '@oxlint/plugins'

import { noCascadingLayerProvideRule } from './rules/no-cascading-layer-provide.ts'
import noManualEffectErrorTag from './rules/no-manual-effect-error-tag.ts'
import noManualTagComparison from './rules/no-manual-tag-comparison.ts'
import noManualTaggedConstruction from './rules/no-manual-tagged-construction.ts'
import { noNestedLayerProvideRule } from './rules/no-nested-layer-provide.ts'
import { preferUseMountEffectRule } from './rules/prefer-use-mount-effect.ts'

export default eslintCompatPlugin({
	meta: { name: 'automation' },
	rules: {
		'no-cascading-layer-provide': noCascadingLayerProvideRule,
		'no-manual-effect-error-tag': noManualEffectErrorTag,
		'no-manual-tag-comparison': noManualTagComparison,
		'no-manual-tagged-construction': noManualTaggedConstruction,
		'no-nested-layer-provide': noNestedLayerProvideRule,
		'prefer-use-mount-effect': preferUseMountEffectRule,
	},
})
