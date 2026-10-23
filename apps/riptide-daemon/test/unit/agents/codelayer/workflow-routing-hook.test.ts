import type { PostToolUseHookContext } from '@humanlayer/agentlayer-core'
import { describe, expect, test, vi } from 'vitest'

import { createCodelayerWorkflowRoutingHook } from '../../../../src/agents/codelayer/hooks'

function createContext(overrides: Partial<PostToolUseHookContext> = {}): PostToolUseHookContext {
	return {
		toolName: 'skill',
		input: { skill: 'rpi:create-structure-outline' },
		output: 'created outline',
		done: vi.fn((output?: string) => ({ status: 'done', output }) as never),
		...overrides,
	} as PostToolUseHookContext
}

describe('createCodelayerWorkflowRoutingHook', () => {
	test('appends setup-worktree context for outline_only with later worktree timing', async () => {
		const ctx = createContext()
		const hook = createCodelayerWorkflowRoutingHook('outline_only', 'later')

		await hook(ctx)

		expect(ctx.done).toHaveBeenCalledWith(expect.stringContaining('created outline'))
		expect(ctx.done).toHaveBeenCalledWith(expect.stringContaining('/rpi:setup-worktree'))
	})

	test('reads CodeLayer skill name from name input field', async () => {
		const ctx = createContext({ input: { name: 'rpi:create-structure-outline' } })
		const hook = createCodelayerWorkflowRoutingHook('outline_only', 'later')

		await hook(ctx)

		expect(ctx.done).toHaveBeenCalledWith(expect.stringContaining('/rpi:setup-worktree'))
	})

	test('appends implement-outline context for outline_only with never worktree timing', async () => {
		const ctx = createContext()
		const hook = createCodelayerWorkflowRoutingHook('outline_only', 'never')

		await hook(ctx)

		expect(ctx.done).toHaveBeenCalledWith(expect.stringContaining('/rpi:implement-outline'))
	})

	test('appends create-prd context for prd_tdd after research', async () => {
		const ctx = createContext({ input: { skill: 'rpi:create-research' } })
		const hook = createCodelayerWorkflowRoutingHook('prd_tdd', null)

		await hook(ctx)

		expect(ctx.done).toHaveBeenCalledWith(expect.stringContaining('/rpi:create-prd'))
	})

	test('no-ops when workflow routing does not apply', async () => {
		const ctx = createContext({ input: { skill: 'rpi:create-research' } })
		const hook = createCodelayerWorkflowRoutingHook('outline_only', null)

		await hook(ctx)

		expect(ctx.done).toHaveBeenCalledWith()
	})
})
