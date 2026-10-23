import { defineRule } from '@oxlint/plugins'
import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins'

const provisioningMethods = new Set(['provide', 'provideMerge'])

function resolveVariable(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier)
	while (scope !== null) {
		const variable = scope.set.get(identifier.name)
		if (variable !== undefined) return variable
		scope = scope.upper
	}
	return null
}

function isEffectLayerIdentifier(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): boolean {
	const variable = resolveVariable(sourceCode, identifier)
	if (variable === null) return false
	return variable.defs.some((definition) => {
		if (definition.type !== 'ImportBinding' || definition.parent?.type !== 'ImportDeclaration') return false
		if (definition.parent.source.value === 'effect') {
			return (
				definition.node.type === 'ImportSpecifier' &&
				(definition.node.imported.type === 'Identifier'
					? definition.node.imported.name
					: definition.node.imported.value) === 'Layer'
			)
		}
		return (
			definition.parent.source.value === 'effect/Layer' &&
			(definition.node.type === 'ImportNamespaceSpecifier' || definition.node.type === 'ImportDefaultSpecifier')
		)
	})
}

function isLayerProvision(sourceCode: SourceCode, node: ESTree.CallExpression['arguments'][number]): boolean {
	if (
		node.type !== 'CallExpression' ||
		node.callee.type !== 'MemberExpression' ||
		node.callee.object.type !== 'Identifier' ||
		!isEffectLayerIdentifier(sourceCode, node.callee.object)
	) {
		return false
	}

	const property = node.callee.property
	const propertyName =
		property.type === 'Identifier'
			? property.name
			: property.type === 'Literal' && typeof property.value === 'string'
				? property.value
				: undefined
	return provisioningMethods.has(propertyName ?? '')
}

/** Keep one dependency-composition stage per Layer pipe. */
export const noCascadingLayerProvideRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Combine independent Layer dependencies in one provide call and extract intentional dependency stages.',
		},
		messages: {
			cascadingProvide:
				'Avoid multiple Layer.provide or Layer.provideMerge stages in one pipe. Combine independent dependencies in one Layer.provide(Layer.mergeAll(...)). When one layer depends on another, extract and name that configured layer before providing it at the application runtime composition root.',
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (
					node.callee.type !== 'MemberExpression' ||
					node.callee.property.type !== 'Identifier' ||
					node.callee.property.name !== 'pipe'
				) {
					return
				}

				const provisioningStages = node.arguments.filter((argument) =>
					isLayerProvision(context.sourceCode, argument),
				)
				if (provisioningStages.length < 2) return

				context.report({ node, messageId: 'cascadingProvide' })
			},
		}
	},
})
