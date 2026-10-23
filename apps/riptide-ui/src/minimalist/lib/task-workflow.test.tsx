import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskWorkflow, workflowOption, workflowOptions } from './task-workflow'

const { state, update } = vi.hoisted(() => ({
	state: {
		task: {} as Record<string, unknown>,
		autoAdvanceOn: true,
	},
	update: vi.fn(() => Promise.resolve({ success: true })),
}))
vi.mock('@/minimalist/lib/data', () => ({ useTask: () => ({ task: state.task }) }))
vi.mock('@/minimalist/lib/auto-advance', () => ({ useTaskAutoAdvance: () => ({ on: state.autoAdvanceOn }) }))
vi.mock('@/hooks/use-browser-auth', () => ({ useBrowserAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: { tasks: { update } } }) }))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))

beforeEach(() => {
	vi.clearAllMocks()
	state.task = { id: 'task', workflow_type: 'freeform', worktree_timing: 'now', resource_owner_user_id: 'me' }
	state.autoAdvanceOn = true
})

describe('workflow options', () => {
	it('names legacy rpi tasks RPI and lists oneshot only for oneshot tasks', () => {
		expect(workflowOption('rpi').label).toBe('RPI')
		expect(workflowOptions('freeform').map((option) => option.value)).toEqual([
			'freeform',
			'outline_only',
			'prd_tdd',
		])
		expect(workflowOptions('oneshot').map((option) => option.value)).toContain('oneshot')
	})
})

describe('useTaskWorkflow', () => {
	it('switches the workflow and keeps auto-advance on for the new hand-offs', async () => {
		const { result } = renderHook(() => useTaskWorkflow('task'))
		expect(result.current).toMatchObject({ current: 'freeform', canChange: true })
		await result.current.change('outline_only')
		expect(update).toHaveBeenCalledWith({
			taskId: 'task',
			workflowType: 'outline_only',
			autoAdvanceQuestionsToResearch: true,
			autoAdvanceResearchToDesign: true,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: false,
		})
	})

	it('only lets the owner change it', () => {
		state.task = { ...state.task, resource_owner_user_id: 'someone-else' }
		const { result } = renderHook(() => useTaskWorkflow('task'))
		expect(result.current.canChange).toBe(false)
	})
})
