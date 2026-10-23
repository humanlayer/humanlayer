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

function isLayerProvision(sourceCode: SourceCode, node: ESTree.Node): node is ESTree.CallExpression {
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

type VisitorKeys = Readonly<Record<string, readonly string[]>>

const functionNodes = new Set([
	'ArrowFunctionExpression',
	'FunctionDeclaration',
	'FunctionExpression',
	'TSEmptyBodyFunctionExpression',
])

function isNode(value: unknown): value is ESTree.Node {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
}

function findLayerProvision(
	sourceCode: SourceCode,
	visitorKeys: VisitorKeys,
	node: ESTree.Node,
): ESTree.CallExpression | null {
	if (isLayerProvision(sourceCode, node)) return node
	// A callback may construct an independent Layer graph; it is not part of the
	// enclosing layer expression merely because the callback is passed inline.
	if (functionNodes.has(node.type)) return null

	const record = node as unknown as Readonly<Record<string, unknown>>
	for (const key of visitorKeys[node.type] ?? []) {
		const value = record[key]
		if (isNode(value)) {
			const provision = findLayerProvision(sourceCode, visitorKeys, value)
			if (provision !== null) return provision
			continue
		}
		if (!Array.isArray(value)) continue
		for (const child of value) {
			if (!isNode(child)) continue
			const provision = findLayerProvision(sourceCode, visitorKeys, child)
			if (provision !== null) return provision
		}
	}
	return null
}

/** Keep Layer dependency graphs named and flat instead of nesting provide calls inline. */
export const noNestedLayerProvideRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description: 'Avoid nested Layer.provide or Layer.provideMerge calls; extract the configured inner layer.',
		},
		messages: {
			nestedProvide:
				'Avoid nested Layer.provide or Layer.provideMerge calls. Extract and name the configured inner layer, then compose it at the application runtime root. Use Layer.provideMerge when the provided services must remain available to later operations.',
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				if (!isLayerProvision(context.sourceCode, node)) return
				for (const argument of node.arguments) {
					const nestedProvision = findLayerProvision(
						context.sourceCode,
						context.sourceCode.visitorKeys,
						argument,
					)
					if (nestedProvision === null) continue
					context.report({ node: nestedProvision, messageId: 'nestedProvide' })
				}
			},
		}
	},
})
