import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'

import { createWorkflowRoutingHook } from '../../../../../src/agents/claudecode/hooks/workflow-routing-hook'

function createHookInput(skill: string): HookInput {
	return {
		hook_event_name: 'PostToolUse',
		session_id: 'test-session',
		cwd: '/test/cwd',
		tool_name: 'Skill',
		tool_input: { skill },
	} as HookInput
}

const routingCases = [
	['outline_only', 'later', 'rpi:create-structure-outline'],
	['outline_only', 'now', 'rpi:iterate-structure-outline'],
	['prd_tdd', null, 'rpi:create-research'],
	['prd_tdd', 'never', 'rpi:create-structure-outline'],
	['rpi', 'now', 'rpi:create-plan'],
	['rpi', 'never', 'rpi:iterate-plan'],
	[null, null, 'rpi:create-structure-outline'],
] as const

describe('createWorkflowRoutingHook', () => {
	test.each(routingCases)('emits workflow context for %s / %s / %s', async (workflowType, worktreeTiming, skill) => {
		const result = await createWorkflowRoutingHook(workflowType, worktreeTiming)(
			createHookInput(skill),
			undefined,
			{ signal: new AbortController().signal },
		)

		expect(result).toMatchObject({
			continue: true,
			hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: expect.any(String) },
		})
	})

	test.each([
		['rpi', 'later', 'rpi:create-plan'],
		['rpi', null, 'rpi:create-research'],
		['outline_only', null, 'rpi:create-research'],
		[null, null, 'rpi:create-research'],
	] as const)('does not route %s / %s / %s', async (workflowType, worktreeTiming, skill) => {
		const result = await createWorkflowRoutingHook(workflowType, worktreeTiming)(
			createHookInput(skill),
			undefined,
			{ signal: new AbortController().signal },
		)

		expect(result).toEqual({ continue: true })
	})
})
