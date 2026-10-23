import { describe, expect, test } from 'vitest'

import { getOnboardingProgress } from './onboarding-progress'

describe('getOnboardingProgress', () => {
	test('appends collaboration after the existing setup milestones', () => {
		const progress = getOnboardingProgress({
			deviceSetupOnly: false,
			hasReadyAgent: true,
			firstTaskCompletedAt: 1,
			firstStructuredWorkflowCompletedAt: 2,
			collaboration: 'incomplete',
			github: 'hidden',
		})

		expect(progress.steps.map(({ id }) => id)).toEqual(['agent', 'task', 'workflow', 'collaboration'])
		expect(progress.nextIncompleteStep).toBe('collaboration')
		expect(progress.remaining).toBe(1)
	})

	test('does not count collaboration until current-scope settings are ready', () => {
		const progress = getOnboardingProgress({
			deviceSetupOnly: false,
			hasReadyAgent: true,
			firstTaskCompletedAt: 1,
			firstStructuredWorkflowCompletedAt: 2,
			collaboration: 'pending',
			github: 'hidden',
		})

		expect(progress.steps.map(({ id }) => id)).toEqual(['agent', 'task', 'workflow'])
		expect(progress.remaining).toBe(0)
	})

	test('places GitHub last, after collaboration', () => {
		const progress = getOnboardingProgress({
			deviceSetupOnly: false,
			hasReadyAgent: true,
			firstTaskCompletedAt: 1,
			firstStructuredWorkflowCompletedAt: 2,
			collaboration: 'complete',
			github: 'incomplete',
		})

		expect(progress.steps.map(({ id }) => id)).toEqual(['agent', 'task', 'workflow', 'collaboration', 'github'])
		expect(progress.nextIncompleteStep).toBe('github')
		expect(progress.remaining).toBe(1)
	})

	test('counts a connected GitHub as complete', () => {
		const progress = getOnboardingProgress({
			deviceSetupOnly: false,
			hasReadyAgent: true,
			firstTaskCompletedAt: 1,
			firstStructuredWorkflowCompletedAt: 2,
			collaboration: 'complete',
			github: 'complete',
		})

		expect(progress.steps.at(-1)).toEqual({ id: 'github', complete: true })
		expect(progress.remaining).toBe(0)
	})

	test('keeps device-only setup limited to the coding agent', () => {
		const progress = getOnboardingProgress({
			deviceSetupOnly: true,
			hasReadyAgent: false,
			firstTaskCompletedAt: null,
			firstStructuredWorkflowCompletedAt: null,
			collaboration: 'incomplete',
			github: 'incomplete',
		})

		expect(progress.steps.map(({ id }) => id)).toEqual(['agent'])
	})
})
