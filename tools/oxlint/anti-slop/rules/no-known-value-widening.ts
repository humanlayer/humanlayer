import { defineRule } from '@oxlint/plugins'
import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins'

import {
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	type TypeEnvironment,
	type WideningTarget,
} from '../shared/dictionary-types.ts'

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
	let current = expression
	while (
		current.type === 'ParenthesizedExpression' ||
		current.type === 'TSAsExpression' ||
		current.type === 'TSSatisfiesExpression' ||
		current.type === 'TSTypeAssertion' ||
		current.type === 'TSNonNullExpression'
	) {
		current = current.expression
	}
	return current
}

function resolveVariable(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier)
	while (scope !== null) {
		const variable = scope.set.get(identifier.name)
		if (variable !== undefined) return variable
		scope = scope.upper
	}
	return null
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	if (variable.defs.length !== 1) return null
	const [definition] = variable.defs
	return definition?.type === 'Variable' && definition.node.type === 'VariableDeclarator' ? definition.node : null
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
	return (
		declarator.parent.type === 'VariableDeclaration' &&
		declarator.parent.kind === 'const' &&
		variable.references.every((reference) => reference.init || !reference.isWrite())
	)
}

function hasKnownEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	visitedVariables = new Set<Variable>(),
): boolean {
	if (isKnownEvidenceExpression(expression)) return true
	const unwrapped = unwrapExpression(expression)
	if (unwrapped.type !== 'Identifier') return false
	const variable = resolveVariable(sourceCode, unwrapped)
	if (variable === null || visitedVariables.has(variable)) return false
	const declarator = variableDeclarator(variable)
	if (declarator === null || declarator.init === null || !isStableConstVariable(variable, declarator)) {
		return false
	}
	visitedVariables.add(variable)
	return hasKnownEvidence(sourceCode, declarator.init, visitedVariables)
}

function annotationTarget(
	annotation: ESTree.TSTypeAnnotation | null | undefined,
	environment: TypeEnvironment,
): WideningTarget | null {
	return annotation === null || annotation === undefined
		? null
		: classifyWideningTarget(annotation.typeAnnotation, environment)
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
	let current: ESTree.Node | null = node.parent
	while (current !== null && current.type !== 'Program') {
		if (
			current.type === 'ArrowFunctionExpression' ||
			current.type === 'FunctionDeclaration' ||
			current.type === 'FunctionExpression'
		) {
			return current
		}
		current = current.parent
	}
	return null
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
	if (key.type === 'Identifier' || key.type === 'PrivateIdentifier') return key.name
	if (key.type === 'Literal') return String(key.value)
	return sourceCode.getText(key)
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
	if (owner === null) return 'anonymous function'
	if (owner.id !== null) return owner.id.name
	const parent = owner.parent
	if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
	if (parent.type === 'MethodDefinition') return sourceKeyName(sourceCode, parent.key)
	return 'anonymous function'
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
	const unwrapped = unwrapExpression(expression)
	return unwrapped.type === 'ObjectExpression' && unwrapped.properties.length === 0
}

function isStaticallyKnownPropertyKey(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	visitedVariables = new Set<Variable>(),
): boolean {
	const unwrapped = unwrapExpression(expression)
	if (unwrapped.type === 'Literal') return true
	if (unwrapped.type === 'TemplateLiteral') {
		return unwrapped.expressions.every((part) => isStaticallyKnownPropertyKey(sourceCode, part, visitedVariables))
	}
	if (unwrapped.type === 'BinaryExpression' && unwrapped.operator === '+') {
		return (
			isStaticallyKnownPropertyKey(sourceCode, unwrapped.left, visitedVariables) &&
			isStaticallyKnownPropertyKey(sourceCode, unwrapped.right, visitedVariables)
		)
	}
	if (unwrapped.type !== 'Identifier') return false
	const variable = resolveVariable(sourceCode, unwrapped)
	if (variable === null || visitedVariables.has(variable)) return false
	const declarator = variableDeclarator(variable)
	if (declarator?.init === null || declarator?.init === undefined || !isStableConstVariable(variable, declarator)) {
		return false
	}
	visitedVariables.add(variable)
	return isStaticallyKnownPropertyKey(sourceCode, declarator.init, visitedVariables)
}

function hasAccumulatorMemberWrite(sourceCode: SourceCode, variable: Variable): boolean {
	return variable.references.some((reference) => {
		const identifier = reference.identifier
		const member = identifier.parent
		if (
			member.type !== 'MemberExpression' ||
			member.object !== identifier ||
			member.parent.type !== 'AssignmentExpression'
		) {
			return false
		}
		if (member.parent.left !== member || !member.computed) return false
		return !isStaticallyKnownPropertyKey(sourceCode, member.property, new Set())
	})
}

function isDictionaryAccumulatorBinding(sourceCode: SourceCode, declarator: ESTree.VariableDeclarator): boolean {
	if (declarator.id.type !== 'Identifier' || declarator.init?.type !== 'ObjectExpression') return false
	const variable = resolveVariable(sourceCode, declarator.id)
	return variable !== null && hasAccumulatorMemberWrite(sourceCode, variable)
}

function identifierAnnotation(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): ESTree.TSTypeAnnotation | null {
	const variable = resolveVariable(sourceCode, identifier)
	if (variable === null || variable.defs.length !== 1) return null
	const definition = variable.defs[0]
	if (definition?.type === 'Variable' && definition.node.type === 'VariableDeclarator') {
		return definition.node.id.type === 'Identifier' ? (definition.node.id.typeAnnotation ?? null) : null
	}
	if (definition?.type === 'Parameter') return definition.name.typeAnnotation ?? null
	return null
}

function isOpenDictionaryAnnotation(annotation: ESTree.TSTypeAnnotation, environment: TypeEnvironment): boolean {
	const type = annotation.typeAnnotation
	if (type.type === 'TSUnionType') {
		return type.types.some((member) => {
			const target = classifyWideningTarget(member, environment)
			return target !== null && isDictionaryAccumulatorTarget(target)
		})
	}
	const target = classifyWideningTarget(type, environment)
	return target !== null && isDictionaryAccumulatorTarget(target)
}

function hasOpenDictionarySpread(
	sourceCode: SourceCode,
	expression: ESTree.ObjectExpression,
	environment: TypeEnvironment,
): boolean {
	return expression.properties.some((property) => {
		if (property.type !== 'SpreadElement') return false
		const argument = unwrapExpression(property.argument)
		if (argument.type !== 'Identifier') return false
		const annotation = identifierAnnotation(sourceCode, argument)
		return annotation !== null && isOpenDictionaryAnnotation(annotation, environment)
	})
}

function isComputedAssignmentTargetAssertion(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): boolean {
	const member = node.parent
	return (
		member.type === 'MemberExpression' &&
		member.object === node &&
		member.computed &&
		member.parent.type === 'AssignmentExpression' &&
		member.parent.left === member
	)
}

function containsCallTo(node: ESTree.Node, name: string): boolean {
	if (node.type === 'Identifier' && node.name === name && node.parent.type === 'CallExpression') {
		if (node.parent.callee === node) return true
		return (
			node.parent.callee.type === 'MemberExpression' &&
			node.parent.callee.property.type === 'Identifier' &&
			(node.parent.callee.property.name === 'map' || node.parent.callee.property.name === 'flatMap') &&
			node.parent.arguments.includes(node)
		)
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent' || value === null || value === undefined) continue
		if (Array.isArray(value)) {
			if (value.some((child) => typeof child === 'object' && 'type' in child && containsCallTo(child, name))) return true
		} else if (typeof value === 'object' && 'type' in value && containsCallTo(value as ESTree.Node, name)) {
			return true
		}
	}
	return false
}

function isRecursiveFunction(_sourceCode: SourceCode, owner: FunctionExpression | null): boolean {
	return owner?.type === 'FunctionDeclaration' && owner.id !== null && containsCallTo(owner.body, owner.id.name)
}

function hasRecursiveTransformReturn(node: ESTree.Node, name: string): boolean {
	if (node.type === 'ReturnStatement') {
		return node.argument !== null && containsCallTo(node.argument, name)
	}
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression'
	) {
		return false
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent' || value === null || value === undefined) continue
		if (Array.isArray(value)) {
			if (
				value.some(
					(child) => typeof child === 'object' && 'type' in child && hasRecursiveTransformReturn(child, name),
				)
			) {
				return true
			}
		} else if (typeof value === 'object' && 'type' in value && hasRecursiveTransformReturn(value as ESTree.Node, name)) {
			return true
		}
	}
	return false
}

function isExplicitUnknownBoundary(expression: ESTree.Expression): boolean {
	let current = expression
	while (current.type === 'ParenthesizedExpression') current = current.expression
	return (
		(current.type === 'TSAsExpression' || current.type === 'TSTypeAssertion') &&
		current.typeAnnotation.type === 'TSUnknownKeyword'
	)
}

function hasExplicitUnknownBoundaryReturn(node: ESTree.Node): boolean {
	if (node.type === 'ReturnStatement') {
		return node.argument !== null && isExplicitUnknownBoundary(node.argument)
	}
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression'
	) {
		return false
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'parent' || value === null || value === undefined) continue
		if (Array.isArray(value)) {
			if (
				value.some(
					(child) => typeof child === 'object' && 'type' in child && hasExplicitUnknownBoundaryReturn(child),
				)
			) {
				return true
			}
		} else if (
			typeof value === 'object' &&
			'type' in value &&
			hasExplicitUnknownBoundaryReturn(value as ESTree.Node)
		) {
			return true
		}
	}
	return false
}

function isDynamicDictionaryConstruction(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	accumulatorBindings: WeakSet<ESTree.VariableDeclarator>,
	environment: TypeEnvironment,
): boolean {
	const unwrapped = unwrapExpression(expression)
	if (unwrapped.type === 'ObjectExpression') {
		return (
			unwrapped.properties.length === 0 ||
			unwrapped.properties.some(
				(property) =>
					property.type === 'Property' &&
					property.computed &&
					!isStaticallyKnownPropertyKey(sourceCode, property.key as ESTree.Expression, new Set()),
			) ||
			hasOpenDictionarySpread(sourceCode, unwrapped, environment)
		)
	}
	if (unwrapped.type !== 'Identifier') return false
	const variable = resolveVariable(sourceCode, unwrapped)
	if (variable === null) return false
	const declarator = variableDeclarator(variable)
	return (
		declarator?.init?.type === 'ObjectExpression' &&
		(declarator.init.properties.length === 0 ||
			accumulatorBindings.has(declarator) ||
			hasOpenDictionarySpread(sourceCode, declarator.init, environment))
	)
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
	return destination.kind === 'open dictionary' || destination.kind === 'generic container'
}

function hasParentAssertion(node: ESTree.Node): boolean {
	return node.parent?.type === 'TSAsExpression' || node.parent?.type === 'TSTypeAssertion'
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.',
		},
		messages: {
			widening:
				'The explicit {{target}} type on {{subject}} discards known type evidence. Keep the precise inferred type or use a named owner contract.',
			broadSatisfies:
				'`satisfies` against {{target}} only launders this known value through a broad compatibility check. Keep inference or check against a finite domain or named owner contract.',
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null
		const accumulatorBindings = new WeakSet<ESTree.VariableDeclarator>()

		const reportFlow = (expression: ESTree.Expression, destination: WideningTarget | null, subject: string) => {
			if (destination === null) return
			if (isDictionaryAccumulatorTarget(destination) && isEmptyObjectExpression(expression)) {
				return
			}
			if (!hasKnownEvidence(context.sourceCode, expression)) return
			context.report({
				node: expression,
				messageId: 'widening',
				data: { subject, target: destination.kind },
			})
		}

		const targetFromAnnotation = (annotation: ESTree.TSTypeAnnotation | null | undefined) =>
			environment === null ? null : annotationTarget(annotation, environment)

		return {
			Program(node) {
				environment = createTypeEnvironment(node)
			},
			VariableDeclarator(node) {
				if (node.init === null || node.id.type !== 'Identifier') return
				const destination = targetFromAnnotation(node.id.typeAnnotation)
				if (
					destination !== null &&
					isDictionaryAccumulatorTarget(destination) &&
					(isDictionaryAccumulatorBinding(context.sourceCode, node) ||
						(environment !== null &&
							node.init.type === 'ObjectExpression' &&
							hasOpenDictionarySpread(context.sourceCode, node.init, environment)))
				) {
					accumulatorBindings.add(node)
					return
				}
				reportFlow(node.init, destination, `binding \`${node.id.name}\``)
			},
			PropertyDefinition(node) {
				if (node.value === null) return
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
				)
			},
			AccessorProperty(node) {
				if (node.value === null) return
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
				)
			},
			AssignmentExpression(node) {
				if (node.operator !== '=' || node.left.type !== 'Identifier') return
				const variable = resolveVariable(context.sourceCode, node.left)
				if (variable === null) return
				const declarator = variableDeclarator(variable)
				if (declarator === null || declarator.id.type !== 'Identifier') return
				reportFlow(
					node.right,
					targetFromAnnotation(declarator.id.typeAnnotation),
					`binding \`${declarator.id.name}\``,
				)
			},
			ReturnStatement(node) {
				if (node.argument === null) return
				const owner = enclosingFunction(node)
				const destination = targetFromAnnotation(owner?.returnType)
				if (destination?.kind === 'unknown') {
					const argument = unwrapExpression(node.argument)
					if (argument.type === 'Identifier') {
						const variable = resolveVariable(context.sourceCode, argument)
						const declarator = variable === null ? null : variableDeclarator(variable)
						if (declarator !== null && accumulatorBindings.has(declarator)) return
					}
					if (isRecursiveFunction(context.sourceCode, owner)) {
						if (
							owner?.id !== null &&
							owner?.id !== undefined &&
							hasRecursiveTransformReturn(owner.body, owner.id.name) &&
							(argument.type === 'Literal' ||
								argument.type === 'TemplateLiteral' ||
								argument.type === 'UnaryExpression')
						) {
							return
						}
						if (owner?.id !== null && owner?.id !== undefined && containsCallTo(node.argument, owner.id.name)) {
							return
						}
					}
					if (
						argument.type === 'Literal' &&
						argument.value === null &&
						owner !== null &&
						hasExplicitUnknownBoundaryReturn(owner.body)
					) {
						return
					}
				}
				if (
					destination !== null &&
					environment !== null &&
					isDictionaryAccumulatorTarget(destination) &&
					isDynamicDictionaryConstruction(context.sourceCode, node.argument, accumulatorBindings, environment)
				) {
					return
				}
				reportFlow(node.argument, destination, `return value of \`${functionName(context.sourceCode, owner)}\``)
			},
			ArrowFunctionExpression(node) {
				if (node.body.type === 'BlockStatement') return
				reportFlow(
					node.body,
					targetFromAnnotation(node.returnType),
					`return value of \`${functionName(context.sourceCode, node)}\``,
				)
			},
			TSAsExpression(node) {
				if (environment === null || hasParentAssertion(node) || isComputedAssignmentTargetAssertion(node)) return
				reportFlow(node.expression, classifyWideningTarget(node.typeAnnotation, environment), 'assertion')
			},
			TSTypeAssertion(node) {
				if (environment === null || hasParentAssertion(node) || isComputedAssignmentTargetAssertion(node)) return
				reportFlow(node.expression, classifyWideningTarget(node.typeAnnotation, environment), 'assertion')
			},
			TSSatisfiesExpression(node) {
				if (environment === null || hasParentAssertion(node)) return
				const destination = classifyWideningTarget(node.typeAnnotation, environment)
				if (destination === null || !hasKnownEvidence(context.sourceCode, node.expression)) return
				context.report({
					node,
					messageId: 'broadSatisfies',
					data: { target: destination.kind },
				})
			},
		}
	},
})
