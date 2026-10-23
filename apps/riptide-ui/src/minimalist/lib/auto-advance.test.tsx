import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { autoAdvanceFlags, useTaskAutoAdvance } from './auto-advance'

const { state, updateAutoAdvance } = vi.hoisted(() => ({
	state: {
		task: { id: 'task', workflow_type: 'outline_only', worktree_timing: 'never' } as Record<string, unknown>,
		settings: {} as Record<string, boolean>,
		canEditTask: true,
	},
	updateAutoAdvance: vi.fn(() => ({ isPersisted: { promise: Promise.resolve() } })),
}))
vi.mock('@/minimalist/lib/data', () => ({ useTask: () => ({ task: state.task }) }))
vi.mock('@/hooks/use-browser-auth', () => ({ useBrowserAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('@/components/providers/SyncProvider', () => ({ useSync: () => ({}) }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: {} }) }))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))
vi.mock('@/hooks/useTaskPermissions', () => ({ useTaskPermissions: () => ({ canEditTask: state.canEditTask }) }))
vi.mock('@/hooks/useTaskSettings', () => ({
	useTaskSettings: () => ({ settings: state.settings, updateAutoAdvance }),
}))

const off = {
	autoAdvanceQuestionsToResearch: false,
	autoAdvanceResearchToDesign: false,
	autoAdvancePlanToWorktree: false,
	autoAdvanceWorktreeToImplementation: false,
	autoAdvanceImplementationToPr: false,
}

beforeEach(() => {
	vi.clearAllMocks()
	state.task = { id: 'task', workflow_type: 'outline_only', worktree_timing: 'never' }
	state.settings = { ...off }
	state.canEditTask = true
})

describe('autoAdvanceFlags', () => {
	it.each([
		['rpi', 'never', ['autoAdvanceQuestionsToResearch', 'autoAdvanceResearchToDesign']],
		['outline_only', 'never', ['autoAdvanceQuestionsToResearch', 'autoAdvanceResearchToDesign']],
		['prd_tdd', 'now', ['autoAdvanceQuestionsToResearch', 'autoAdvanceResearchToDesign']],
		[
			'outline_only',
			'later',
			['autoAdvanceQuestionsToResearch', 'autoAdvanceResearchToDesign', 'autoAdvanceWorktreeToImplementation'],
		],
		['oneshot', 'later', ['autoAdvanceImplementationToPr']],
		['freeform', 'never', ['autoAdvanceImplementationToPr']],
	] as const)('%s with worktree %s uses %j', (workflow_type, worktree_timing, expected) => {
		expect(autoAdvanceFlags({ workflow_type, worktree_timing })).toEqual(expected)
	})
})

describe('useTaskAutoAdvance', () => {
	it('turns on every hand-off in the workflow and leaves the rest alone', () => {
		const { result } = renderHook(() => useTaskAutoAdvance('task'))
		expect(result.current).toMatchObject({
			available: true,
			on: false,
			handOffs: ['questions → research', 'research → design'],
		})
		act(() => result.current.toggle())
		expect(updateAutoAdvance).toHaveBeenCalledWith({
			taskId: 'task',
			autoAdvanceQuestionsToResearch: true,
			autoAdvanceResearchToDesign: true,
		})
	})

	it('reads on only when every hand-off is on, and then turns them all off', () => {
		state.task = { id: 'task', workflow_type: 'prd_tdd', worktree_timing: 'never' }
		state.settings = { ...off, autoAdvanceQuestionsToResearch: true }
		const { result, rerender } = renderHook(() => useTaskAutoAdvance('task'))
		expect(result.current.on).toBe(false)
		expect(result.current.handOffs).toEqual(['questions → research', 'research → PRD'])
		state.settings = { ...off, autoAdvanceQuestionsToResearch: true, autoAdvanceResearchToDesign: true }
		rerender()
		expect(result.current.on).toBe(true)
		act(() => result.current.toggle())
		expect(updateAutoAdvance).toHaveBeenCalledWith({
			taskId: 'task',
			autoAdvanceQuestionsToResearch: false,
			autoAdvanceResearchToDesign: false,
		})
	})

	it('hides the switch from people who cannot edit the task', () => {
		state.canEditTask = false
		const { result } = renderHook(() => useTaskAutoAdvance('task'))
		expect(result.current.available).toBe(false)
	})
})
