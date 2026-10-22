import { describe, expect, test } from 'vitest'
import {
	isApplyPatchTool,
	isAgentToolName,
	isFileOperationTool,
	normalizeSkillToolInput,
	normalizeToolName,
	toCanonicalOperation,
} from './tool-names'

describe('normalizeToolName', () => {
	test.each([
		['Read', 'read'],
		['read', 'read'],
		['multi_edit', 'multiedit'],
		['apply-patch', 'applypatch'],
		['web_search', 'websearch'],
		['functions.agent', 'functionsagent'],
		['mcp__github__comment', 'mcpgithubcomment'],
	])('normalizes %s', (input, expected) => {
		expect(normalizeToolName(input)).toBe(expected)
	})
})

describe('toCanonicalOperation', () => {
	const cases: Array<[string, ReturnType<typeof toCanonicalOperation>]> = [
		['Read', 'Read'],
		['read', 'Read'],
		['multi_edit', 'MultiEdit'],
		['MultiEdit', 'MultiEdit'],
		['bash', undefined],
	]

	test.each(cases)('maps %s', (input, expected) => {
		expect(toCanonicalOperation(input)).toBe(expected)
	})
})

describe('isFileOperationTool', () => {
	test.each(['Read', 'read', 'multi_edit', 'MultiEdit'])('recognizes %s as a file operation', (input) => {
		expect(isFileOperationTool(input)).toBe(true)
	})

	test.each(['Bash', 'web_search', undefined, null])('does not treat %s as a file operation', (input) => {
		expect(isFileOperationTool(input)).toBe(false)
	})
})

describe('isApplyPatchTool', () => {
	test.each(['apply_patch', 'apply-patch', 'applypatch'])('recognizes %s as apply_patch', (input) => {
		expect(isApplyPatchTool(input)).toBe(true)
	})

	test.each(['Edit', 'Write', 'Bash', undefined, null])('does not treat %s as apply_patch', (input) => {
		expect(isApplyPatchTool(input)).toBe(false)
	})
})

describe('isAgentToolName', () => {
	test.each(['Task', 'task', 'functions.agent', 'subagent'])('recognizes %s as an agent tool', (input) => {
		expect(isAgentToolName(input)).toBe(true)
	})

	test.each(['Read', 'Bash', undefined, null])('does not treat %s as an agent tool', (input) => {
		expect(isAgentToolName(input)).toBe(false)
	})
})

describe('normalizeSkillToolInput', () => {
	test('normalizes Claude Code Skill tool inputs', () => {
		expect(normalizeSkillToolInput({ skill: 'rpi:create-plan', args: 'research.md' })).toEqual({
			skill: 'rpi:create-plan',
			args: 'research.md',
		})
	})

	test('normalizes CodeLayer skill tool inputs', () => {
		expect(normalizeSkillToolInput({ name: 'rpi:implement-plan', args: 'plan.md' })).toEqual({
			skill: 'rpi:implement-plan',
			args: 'plan.md',
		})
	})

	test('falls back to CodeLayer name when skill is empty', () => {
		expect(normalizeSkillToolInput({ skill: '', name: 'rpi:create-research' })).toEqual({
			skill: 'rpi:create-research',
		})
	})

	test.each([null, undefined, 'rpi:create-plan', {}, { args: 'plan.md' }, { name: '' }])(
		'rejects invalid input %#',
		(input) => {
			expect(normalizeSkillToolInput(input)).toBeNull()
		},
	)
})
