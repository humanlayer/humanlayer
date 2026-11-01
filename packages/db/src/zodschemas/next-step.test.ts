import { describe, expect, test } from 'vitest'

import { normalizeSuggestedDirectory, NextStepSuggestionSchema } from './next-step'

describe('normalizeSuggestedDirectory', () => {
	test.each(['~/wt/project', '/tmp/project', './project', '../project', 'C:\\work\\project', '\\\\server\\share'])(
		'accepts path-like directory %s',
		(value) => {
			expect(normalizeSuggestedDirectory(value)).toBe(value)
		},
	)

	test.each([
		'none specified in message about running location',
		'/home/agent/workspace/none specified in message about running location, not in directory instructions',
		'thoughts/tasks/core-180/',
		'~/wt/project with an explanation',
		'',
		null,
		42,
	])('drops non-directory model output %p', (value) => {
		expect(normalizeSuggestedDirectory(value)).toBeUndefined()
	})
})

test('normalizes invalid persisted directory hints while preserving valid ones', () => {
	const parsed = NextStepSuggestionSchema.parse({
		parsedAt: 1,
		extraction: {
			type: 'next_step_found',
			nextStepPrompt: 'use the rpi:setup-worktree skill for task-1',
			nextStepSummary: 'setup-worktree: task-1',
			nextStepType: 'setup-worktree',
			taskReference: 'task-1',
			suggestedDirectory: 'reasoning about the directory',
		},
	})

	if (parsed.extraction.type !== 'next_step_found') throw new Error('expected next step')
	expect(parsed.extraction.suggestedDirectory).toBeUndefined()

	const valid = NextStepSuggestionSchema.parse({
		...parsed,
		extraction: { ...parsed.extraction, suggestedDirectory: '~/wt/task-1' },
	})
	if (valid.extraction.type !== 'next_step_found') throw new Error('expected next step')
	expect(valid.extraction.suggestedDirectory).toBe('~/wt/task-1')
})
