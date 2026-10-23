import { describe, it } from '@effect/vitest'
import { DateTime, Effect } from 'effect'
import { expect } from 'vitest'

import {
	makeExperimentAnalyticsService,
	type ExperimentAnalyticsClient,
} from '../../src/effects/services/experiment-analytics/experiment-analytics.service'

const input = {
	userId: 'user_123',
	taskId: '019fb7ee-a86a-7dcf-9915-a8e0ea08f559',
	createdAt: 1_700_000_000_500,
	assigned_group: 'v3_composer',
	actual_form: 'v2_form',
} as const

const sessionCreatedInput = {
	userId: 'user_456',
	sessionId: '019fb7ee-a86a-7dcf-9915-a8e0ea08f560',
	taskId: '019fb7ee-a86a-7dcf-9915-a8e0ea08f561',
	codingAgent: 'claude',
	createdAt: 1_700_000_001_000,
} as const

const projectsV2AssignedInput = {
	userId: 'user_789',
	organizationId: '019fb7ee-a86a-7dcf-9915-a8e0ea08f562',
	assignedVariant: 'v2',
	assignedAt: 1_700_000_002_000,
} as const

describe('ExperimentAnalyticsService', () => {
	it.effect('sends the allowlisted task-created payload', () =>
		Effect.gen(function* () {
			const captures: Parameters<ExperimentAnalyticsClient['captureImmediate']>[0][] = []
			const service = makeExperimentAnalyticsService({
				captureImmediate: async (event) => {
					captures.push(event)
				},
			})
			yield* service.recordTaskComposerTaskCreated(input)
			expect(captures).toEqual([
				{
					distinctId: input.userId,
					event: 'task_composer_task_created',
					uuid: input.taskId,
					timestamp: DateTime.toDateUtc(DateTime.makeUnsafe(input.createdAt)),
					properties: {
						task_id: input.taskId,
						assigned_group: 'v3_composer',
						actual_form: 'v2_form',
					},
				},
			])
		}),
	)

	it.effect('sends the allowlisted coding-agent session created payload', () =>
		Effect.gen(function* () {
			const captures: Parameters<ExperimentAnalyticsClient['captureImmediate']>[0][] = []
			const service = makeExperimentAnalyticsService({
				captureImmediate: async (event) => {
					captures.push(event)
				},
			})
			yield* service.recordCodingAgentSessionCreated(sessionCreatedInput)
			expect(captures).toEqual([
				{
					distinctId: sessionCreatedInput.userId,
					event: 'coding_agent_session_created',
					uuid: sessionCreatedInput.sessionId,
					timestamp: DateTime.toDateUtc(DateTime.makeUnsafe(sessionCreatedInput.createdAt)),
					properties: {
						session_id: sessionCreatedInput.sessionId,
						task_id: sessionCreatedInput.taskId,
						coding_agent: sessionCreatedInput.codingAgent,
					},
				},
			])
		}),
	)

	it.effect('sends a null task_id for a session created without a task', () =>
		Effect.gen(function* () {
			const captures: Parameters<ExperimentAnalyticsClient['captureImmediate']>[0][] = []
			const service = makeExperimentAnalyticsService({
				captureImmediate: async (event) => {
					captures.push(event)
				},
			})
			yield* service.recordCodingAgentSessionCreated({ ...sessionCreatedInput, taskId: null })
			expect(captures[0]?.properties).toMatchObject({ task_id: null, coding_agent: 'claude' })
		}),
	)

	for (const [assignedVariant, flagVariant] of [
		['v1', 'control'],
		['v2', 'test'],
	] as const) {
		it.effect(
			`sends the Projects V2 assignment payload for ${assignedVariant} as flag variant ${flagVariant}`,
			() =>
				Effect.gen(function* () {
					const captures: Parameters<ExperimentAnalyticsClient['captureImmediate']>[0][] = []
					const service = makeExperimentAnalyticsService({
						captureImmediate: async (event) => {
							captures.push(event)
						},
					})
					yield* service.recordProjectsV2Assigned({ ...projectsV2AssignedInput, assignedVariant })
					expect(captures).toEqual([
						{
							distinctId: projectsV2AssignedInput.userId,
							event: 'projects_v2_assigned',
							uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
							timestamp: DateTime.toDateUtc(DateTime.makeUnsafe(projectsV2AssignedInput.assignedAt)),
							properties: {
								organization_id: projectsV2AssignedInput.organizationId,
								assigned_variant: assignedVariant,
								'$feature/projects-v2-rollout': flagVariant,
							},
						},
					])
				}),
		)
	}

	it.effect('swallows Projects V2 assignment delivery failure', () =>
		makeExperimentAnalyticsService({
			captureImmediate: async () => Promise.reject(new Error('offline')),
		}).recordProjectsV2Assigned(projectsV2AssignedInput),
	)

	it.effect('swallows Projects V2 assignment client defects', () =>
		makeExperimentAnalyticsService({
			captureImmediate: () => {
				throw new Error('client defect')
			},
		}).recordProjectsV2Assigned(projectsV2AssignedInput),
	)

	it.effect('swallows client failure', () =>
		makeExperimentAnalyticsService({
			captureImmediate: async () => Promise.reject(new Error('offline')),
		}).recordTaskComposerTaskCreated(input),
	)

	it.effect('swallows client defects', () =>
		makeExperimentAnalyticsService({
			captureImmediate: () => {
				throw new Error('client defect')
			},
		}).recordTaskComposerTaskCreated(input),
	)
})
