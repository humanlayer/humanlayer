import * as Schema from 'effect/Schema'

export const CollaborationProgress = Schema.Literals(['pending', 'incomplete', 'complete'])
export type CollaborationProgress = Schema.Schema.Type<typeof CollaborationProgress>

/** `hidden` for members, for the experiment flag off, and while the connection is still unknown. */
export const GitHubProgress = Schema.Literals(['hidden', 'incomplete', 'complete'])
export type GitHubProgress = Schema.Schema.Type<typeof GitHubProgress>

export const OnboardingProgressInput = Schema.Struct({
	deviceSetupOnly: Schema.Boolean,
	hasReadyAgent: Schema.Boolean,
	firstTaskCompletedAt: Schema.NullOr(Schema.Number),
	firstStructuredWorkflowCompletedAt: Schema.NullOr(Schema.Number),
	collaboration: CollaborationProgress,
	github: GitHubProgress,
})
export interface OnboardingProgressInput extends Schema.Schema.Type<typeof OnboardingProgressInput> {}

export type OnboardingStepId = 'agent' | 'task' | 'workflow' | 'collaboration' | 'github'

export interface OnboardingProgressStep {
	readonly id: OnboardingStepId
	readonly complete: boolean
}

export function getOnboardingProgress(input: OnboardingProgressInput): {
	readonly steps: ReadonlyArray<OnboardingProgressStep>
	readonly nextIncompleteStep: OnboardingStepId | null
	readonly remaining: number
} {
	const steps: OnboardingProgressStep[] = [{ id: 'agent', complete: input.hasReadyAgent }]
	if (!input.deviceSetupOnly) {
		steps.push(
			{ id: 'task', complete: input.firstTaskCompletedAt !== null },
			{ id: 'workflow', complete: input.firstStructuredWorkflowCompletedAt !== null },
		)
		if (input.collaboration !== 'pending') {
			steps.push({ id: 'collaboration', complete: input.collaboration === 'complete' })
		}
		if (input.github !== 'hidden') {
			steps.push({ id: 'github', complete: input.github === 'complete' })
		}
	}

	return {
		steps,
		nextIncompleteStep: steps.find((step) => !step.complete)?.id ?? null,
		remaining: steps.filter((step) => !step.complete).length,
	}
}
