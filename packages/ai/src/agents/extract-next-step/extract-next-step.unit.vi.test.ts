import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as object),
		Output: { object: vi.fn((value) => value) },
		generateText: vi.fn(async () => ({
			output: {
				found: true,
				nextStepPrompt: 'use the rpi:setup-worktree skill for task-1',
				nextStepSummary: 'setup-worktree: task-1',
				nextStepType: 'setup-worktree',
				taskReference: 'task-1',
				suggestedDirectory: 'reasoning about the directory instead of a path',
			},
		})),
	}
})

const { extractNextStep } = await import('./extract-next-step')
const { generateText } = await import('ai')

describe('extractNextStep suggestedDirectory boundary', () => {
	beforeEach(() => {
		vi.mocked(generateText).mockClear()
	})

	test('drops explanatory model output instead of returning it as a directory', async () => {
		const result = await extractNextStep('assistant message', { model: {} as never })

		expect(result.extraction.type).toBe('next_step_found')
		if (result.extraction.type === 'next_step_found') {
			expect(result.extraction.suggestedDirectory).toBeUndefined()
		}
	})

	test('keeps an explicit path from structured output', async () => {
		vi.mocked(generateText).mockResolvedValueOnce({
			output: {
				found: true,
				nextStepPrompt: 'use the rpi:setup-worktree skill for task-1',
				nextStepSummary: 'setup-worktree: task-1',
				nextStepType: 'setup-worktree',
				taskReference: 'task-1',
				suggestedDirectory: '~/wt/task-1',
			},
		} as never)

		const result = await extractNextStep('assistant message', { model: {} as never })

		expect(result.extraction.type).toBe('next_step_found')
		if (result.extraction.type === 'next_step_found') {
			expect(result.extraction.suggestedDirectory).toBe('~/wt/task-1')
		}
	})
})
