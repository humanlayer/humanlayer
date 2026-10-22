import { defineRule } from '@oxlint/plugins'
import type { ESTree, Scope, SourceCode } from '@oxlint/plugins'

function isReactImport(sourceCode: SourceCode, identifier: ESTree.IdentifierReference, member: boolean): boolean {
	let scope: Scope | null = sourceCode.getScope(identifier)
	while (scope !== null) {
		const variable = scope.set.get(identifier.name)
		if (variable !== undefined) {
			return variable.defs.some((definition) => {
				if (
					definition.type !== 'ImportBinding' ||
					definition.parent?.type !== 'ImportDeclaration' ||
					definition.parent.source.value !== 'react' ||
					definition.parent.importKind === 'type'
				)
					return false
				const specifier = definition.node
				if (specifier.type === 'ImportSpecifier') {
					if (specifier.importKind === 'type') return false
					const imported =
						specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
					return imported === (member ? 'default' : 'useEffect')
				}
				return (
					member &&
					(specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier')
				)
			})
		}
		scope = scope.upper
	}
	return false
}

export const preferUseMountEffectRule = defineRule({
	meta: {
		type: 'problem',
		docs: { description: 'Use the existing useMountEffect helper for explicit empty effect dependencies.' },
		messages: {
			preferMount:
				'Use useMountEffect(callback) instead of useEffect(callback, []). Import from @/hooks/useMountEffect in riptide-ui/riptide-cloud; shared UI: packages/ui/src/hooks/use-mount-effect.ts.',
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				const deps = node.arguments[1]
				if (
					node.optional ||
					node.arguments.length !== 2 ||
					deps?.type !== 'ArrayExpression' ||
					deps.elements.length !== 0
				)
					return
				const callee = node.callee
				if (callee.type === 'Identifier') {
					if (!isReactImport(context.sourceCode, callee, false)) return
				} else if (
					callee.type === 'MemberExpression' &&
					!callee.optional &&
					callee.object.type === 'Identifier'
				) {
					const property = callee.property
					const isUseEffect = callee.computed
						? property.type === 'Literal' && property.value === 'useEffect'
						: property.type === 'Identifier' && property.name === 'useEffect'
					if (!isUseEffect || !isReactImport(context.sourceCode, callee.object, true)) return
				} else return
				context.report({ node, messageId: 'preferMount' })
			},
		}
	},
})
