import { describe, expect, it } from '@effect/vitest'
import {
	ResolvedTaskWorkflow,
	ResolvedTaskWorkflowType,
	TaskAutoAdvanceFlags,
	TaskWorkflowType,
	WorktreeTiming,
	isStructuredTaskWorkflow,
} from '@humanlayer/schemas/effect/taskconfiguration'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

describe('task configuration schemas', () => {
	it.effect('decodes every persisted and resolved workflow type', () =>
		Effect.gen(function* () {
			for (const workflowType of ['rpi', 'outline_only', 'prd_tdd', 'oneshot', 'freeform']) {
				expect(yield* Schema.decodeUnknownEffect(TaskWorkflowType)(workflowType)).toBe(workflowType)
			}
			for (const workflowType of ['outline_only', 'prd_tdd', 'oneshot', 'freeform']) {
				expect(yield* Schema.decodeUnknownEffect(ResolvedTaskWorkflowType)(workflowType)).toBe(workflowType)
			}
		}),
	)

	it.effect('keeps legacy rpi out of resolved V3 workflows', () =>
		Effect.gen(function* () {
			expect((yield* Effect.exit(Schema.decodeUnknownEffect(ResolvedTaskWorkflowType)('rpi')))._tag).toBe(
				'Failure',
			)
			expect((yield* Effect.exit(Schema.decodeUnknownEffect(TaskWorkflowType)('unsupported')))._tag).toBe(
				'Failure',
			)
		}),
	)

	it('identifies every structured persisted workflow', () => {
		expect(isStructuredTaskWorkflow('rpi')).toBe(true)
		expect(isStructuredTaskWorkflow('outline_only')).toBe(true)
		expect(isStructuredTaskWorkflow('prd_tdd')).toBe(true)
		expect(isStructuredTaskWorkflow('oneshot')).toBe(false)
		expect(isStructuredTaskWorkflow('freeform')).toBe(false)
	})

	it.effect('decodes worktree timing and rejects unsupported values', () =>
		Effect.gen(function* () {
			for (const timing of ['now', 'later', 'never']) {
				expect(yield* Schema.decodeUnknownEffect(WorktreeTiming)(timing)).toBe(timing)
			}
			expect((yield* Effect.exit(Schema.decodeUnknownEffect(WorktreeTiming)('immediate')))._tag).toBe('Failure')
		}),
	)

	it.effect('decodes resolved workflow intent and projected auto-advance flags', () =>
		Effect.gen(function* () {
			const workflow = { workflowType: 'outline_only', autoAdvance: true }
			expect(yield* Schema.decodeUnknownEffect(ResolvedTaskWorkflow)(workflow)).toEqual(workflow)

			const flags = {
				autoAdvanceQuestionsToResearch: true,
				autoAdvanceResearchToDesign: true,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: true,
				autoAdvanceImplementationToPr: false,
			}
			expect(yield* Schema.decodeUnknownEffect(TaskAutoAdvanceFlags)(flags)).toEqual(flags)
		}),
	)
})
