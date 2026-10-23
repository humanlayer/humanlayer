import { defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

function unwrapParentheses(node: ESTree.Expression): ESTree.Expression {
	let current = node
	while (current.type === 'ParenthesizedExpression') {
		current = current.expression
	}
	return current
}

function isConditionalSpread(node: ESTree.Expression): boolean {
	const expression = unwrapParentheses(node)
	return expression.type === 'ConditionalExpression' || expression.type === 'LogicalExpression'
}

export const noConditionalSpreadRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow spreading ternary and logical expressions. Build the value explicitly instead.',
		},
		messages: {
			avoid:
				'Conditional spreads obscure which values or properties are present. Build the value in separate statements instead.',
		},
	},
	createOnce(context) {
		return {
			SpreadElement(node) {
				if (isConditionalSpread(node.argument)) {
					context.report({ node, messageId: 'avoid' })
				}
			},
			JSXSpreadAttribute(node) {
				if (isConditionalSpread(node.argument)) {
					context.report({ node, messageId: 'avoid' })
				}
			},
		}
	},
})
