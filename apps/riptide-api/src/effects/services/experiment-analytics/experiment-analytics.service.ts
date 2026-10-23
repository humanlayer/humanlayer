import { randomUUID } from 'node:crypto'

import type { ProjectsV2Variant } from '@humanlayer/db/zodschemas/projects-v2-variant'
import type { TaskComposerSnapshot } from '@humanlayer/riptide-api-contract/api/tasks/experiment-flags'
import * as Sentry from '@sentry/node'
import { Cause, Config, Context, Effect, Layer, Option, Redacted } from 'effect'
import { PostHog } from 'posthog-node'

export interface RecordTaskComposerTaskCreatedInput extends TaskComposerSnapshot {
	readonly userId: string
	readonly taskId: string
	readonly createdAt: number
}

export interface RecordCodingAgentSessionCreatedInput {
	readonly userId: string
	readonly sessionId: string
	readonly taskId: string | null
	readonly codingAgent: string
	readonly createdAt: number
}

export interface RecordProjectsV2AssignedInput {
	readonly userId: string
	readonly organizationId: string
	readonly assignedVariant: ProjectsV2Variant
	readonly assignedAt: number
}

export const PROJECTS_V2_FLAG = 'projects-v2-rollout'

/** PostHog's variant key for each saved group, so its experiment view attributes the event. */
const PROJECTS_V2_FLAG_VARIANTS = {
	v1: 'control',
	v2: 'test',
} as const satisfies Record<ProjectsV2Variant, string>

export class ExperimentAnalyticsService extends Context.Service<
	ExperimentAnalyticsService,
	{
		readonly recordTaskComposerTaskCreated: (
			input: RecordTaskComposerTaskCreatedInput,
		) => Effect.Effect<void, never>
		readonly recordCodingAgentSessionCreated: (
			input: RecordCodingAgentSessionCreatedInput,
		) => Effect.Effect<void, never>
		readonly recordProjectsV2Assigned: (input: RecordProjectsV2AssignedInput) => Effect.Effect<void, never>
	}
>()('ExperimentAnalyticsService') {}

export interface ExperimentAnalyticsClient {
	captureImmediate: (event: {
		distinctId: string
		event: string
		uuid: string
		timestamp: Date
		properties: Record<string, unknown>
	}) => Promise<void>
}

export const EXPERIMENT_ANALYTICS_DELIVERY_TIMEOUT = '250 millis'

const config = Config.all({
	apiKey: Config.option(Config.Redacted('POSTHOG_API_KEY')),
	host: Config.String('POSTHOG_HOST').pipe(Config.withDefault('https://us.i.posthog.com')),
})

const reportAnalyticsCause = (
	message: string,
	operation: string,
	safeContext: Record<string, string>,
	cause: Cause.Cause<unknown>,
) =>
	Effect.logError(message, cause).pipe(
		Effect.annotateLogs(safeContext),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(cause), {
					tags: { operation },
					extra: safeContext,
				}),
			),
		),
		Effect.asVoid,
		Effect.catchCause(() => Effect.void),
	)

const recordAnalyticsSpan = (
	operationName: string,
	safeContext: Record<string, string>,
	operation: Effect.Effect<void, never>,
) =>
	operation.pipe(
		Effect.withSpan(operationName, {
			attributes: safeContext,
		}),
		Effect.catchCause((cause) =>
			reportAnalyticsCause('Experiment analytics operation failed', operationName, safeContext, cause),
		),
	)

const captureEffect = (capture: () => Promise<void>) =>
	Effect.callback<void>((resume) => {
		let active = true
		try {
			capture().then(
				() => {
					if (active) resume(Effect.void)
				},
				(error) => {
					if (active) resume(Effect.die(error))
				},
			)
		} catch (error) {
			resume(Effect.die(error))
		}

		return Effect.sync(() => {
			active = false
		})
	})

const captureBestEffort = (operationName: string, safeContext: Record<string, string>, capture: () => Promise<void>) =>
	captureEffect(capture).pipe(
		Effect.timeout(EXPERIMENT_ANALYTICS_DELIVERY_TIMEOUT),
		Effect.catchCause((cause) =>
			reportAnalyticsCause('Experiment analytics delivery failed', operationName, safeContext, cause),
		),
	)

const shutdownClient = (client: PostHog) =>
	Effect.tryPromise(() => client.shutdown()).pipe(
		Effect.catchCause((cause) =>
			reportAnalyticsCause(
				'Experiment analytics client shutdown failed',
				'experiment_analytics.client_shutdown',
				{},
				cause,
			),
		),
	)

export const makeExperimentAnalyticsService = (client: ExperimentAnalyticsClient) => ({
	recordTaskComposerTaskCreated: (input: RecordTaskComposerTaskCreatedInput) => {
		const safeContext = { taskId: input.taskId, userId: input.userId }
		const operationName = 'experiment_analytics.record_task_composer_task_created'
		return recordAnalyticsSpan(
			operationName,
			safeContext,
			captureBestEffort(operationName, safeContext, () =>
				client.captureImmediate({
					distinctId: input.userId,
					event: 'task_composer_task_created',
					uuid: input.taskId,
					timestamp: new Date(input.createdAt),
					properties: {
						task_id: input.taskId,
						assigned_group: input.assigned_group,
						actual_form: input.actual_form,
					},
				}),
			),
		)
	},
	recordCodingAgentSessionCreated: (input: RecordCodingAgentSessionCreatedInput) => {
		const safeContext = { sessionId: input.sessionId, userId: input.userId }
		const operationName = 'experiment_analytics.record_coding_agent_session_created'
		return recordAnalyticsSpan(
			operationName,
			safeContext,
			captureBestEffort(operationName, safeContext, () =>
				client.captureImmediate({
					distinctId: input.userId,
					event: 'coding_agent_session_created',
					uuid: input.sessionId,
					timestamp: new Date(input.createdAt),
					properties: {
						session_id: input.sessionId,
						task_id: input.taskId,
						coding_agent: input.codingAgent,
					},
				}),
			),
		)
	},
	recordProjectsV2Assigned: (input: RecordProjectsV2AssignedInput) => {
		const safeContext = { organizationId: input.organizationId, userId: input.userId }
		const operationName = 'experiment_analytics.record_projects_v2_assigned'
		return recordAnalyticsSpan(
			operationName,
			safeContext,
			captureBestEffort(operationName, safeContext, () =>
				client.captureImmediate({
					distinctId: input.userId,
					event: 'projects_v2_assigned',
					uuid: randomUUID(),
					timestamp: new Date(input.assignedAt),
					properties: {
						organization_id: input.organizationId,
						assigned_variant: input.assignedVariant,
						[`$feature/${PROJECTS_V2_FLAG}`]: PROJECTS_V2_FLAG_VARIANTS[input.assignedVariant],
					},
				}),
			),
		)
	},
})

const disabledExperimentAnalyticsService = {
	recordTaskComposerTaskCreated: (input: RecordTaskComposerTaskCreatedInput) =>
		recordAnalyticsSpan(
			'experiment_analytics.record_task_composer_task_created',
			{ taskId: input.taskId, userId: input.userId },
			Effect.void,
		),
	recordCodingAgentSessionCreated: (input: RecordCodingAgentSessionCreatedInput) =>
		recordAnalyticsSpan(
			'experiment_analytics.record_coding_agent_session_created',
			{ sessionId: input.sessionId, userId: input.userId },
			Effect.void,
		),
	recordProjectsV2Assigned: (input: RecordProjectsV2AssignedInput) =>
		recordAnalyticsSpan(
			'experiment_analytics.record_projects_v2_assigned',
			{ organizationId: input.organizationId, userId: input.userId },
			Effect.void,
		),
}

export const ExperimentAnalyticsServiceLive = Layer.effect(
	ExperimentAnalyticsService,
	Effect.gen(function* () {
		const loaded = yield* config
		if (Option.isNone(loaded.apiKey)) return disabledExperimentAnalyticsService

		const apiKey = Option.getOrThrow(loaded.apiKey)
		const clientOption = yield* Effect.acquireRelease(
			Effect.sync(() => new PostHog(Redacted.value(apiKey), { host: loaded.host, flushAt: 1, flushInterval: 0 })),
			shutdownClient,
		).pipe(
			Effect.map(Option.some),
			Effect.catchCause((cause) =>
				reportAnalyticsCause(
					'Experiment analytics client initialization failed',
					'experiment_analytics.client_initialization',
					{},
					cause,
				).pipe(Effect.as(Option.none<PostHog>())),
			),
		)
		if (Option.isNone(clientOption)) return disabledExperimentAnalyticsService

		return makeExperimentAnalyticsService({
			captureImmediate: (event) => clientOption.value.captureImmediate(event),
		})
	}),
)
