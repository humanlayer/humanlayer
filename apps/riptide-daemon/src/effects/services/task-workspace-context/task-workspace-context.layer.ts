import type { TaskWorkspaceContext as TaskWorkspaceContextRecord } from '@humanlayer/schemas/effect/project-workspace'
import { Cache, Config, Duration, Effect, Exit, Layer, Predicate, Schedule } from 'effect'

import type {
	DaemonTaskWorkspaceContextError,
	DaemonTaskWorkspaceContextNotFound,
} from '../daemon-api/daemon-api.errors'
import { DaemonApi } from '../daemon-api/daemon-api.service'
import { TaskWorkspaceContext, type TaskWorkspaceContextInput } from './task-workspace-context.service'

/** Transport failures get two quick retries; a task without a project workspace is not retried. */
const retryTransportFailures = {
	times: 2,
	schedule: Schedule.exponential('250 millis'),
	while: (error: DaemonTaskWorkspaceContextError | DaemonTaskWorkspaceContextNotFound) =>
		Predicate.isTagged(error, 'DaemonTaskWorkspaceContextError'),
} as const

export const TaskWorkspaceContextLive = Layer.effect(
	TaskWorkspaceContext,
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const freshness = yield* Config.Duration('RIPTIDE_TASK_WORKSPACE_CONTEXT_FRESHNESS').pipe(
			Config.withDefault('30 seconds'),
		)

		const readContext = Effect.fn('task_workspace_context.read')(function* (taskId: string) {
			return yield* api.getTaskWorkspaceContext({ taskId }).pipe(
				Effect.retry(retryTransportFailures),
				Effect.catchTag('DaemonTaskWorkspaceContextNotFound', () =>
					Effect.succeed<TaskWorkspaceContextRecord | null>(null),
				),
			)
		})

		// A successful read (including a stable "no project workspace") is served for the freshness
		// window; a transport failure is never cached so the next caller retries immediately.
		const cache = yield* Cache.makeWith(
			(taskId: string): Effect.Effect<TaskWorkspaceContextRecord | null, DaemonTaskWorkspaceContextError> =>
				readContext(taskId),
			{
				capacity: 1_000,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? freshness : Duration.zero),
			},
		)

		const degrade = (
			taskId: string,
			read: Effect.Effect<TaskWorkspaceContextRecord | null, DaemonTaskWorkspaceContextError>,
		) =>
			read.pipe(
				Effect.catchTag('DaemonTaskWorkspaceContextError', () =>
					Effect.logWarning('Continuing without project workspace context').pipe(
						Effect.annotateLogs({ task_id: taskId }),
						Effect.as<TaskWorkspaceContextRecord | null>(null),
					),
				),
			)

		const loadTaskWorkspaceContext = Effect.fn('task_workspace_context.load')(function* (
			input: TaskWorkspaceContextInput,
		) {
			yield* Cache.invalidate(cache, input.taskId)
			return yield* Cache.get(cache, input.taskId)
		})

		const recentTaskWorkspaceContext = Effect.fn('task_workspace_context.recent')(function* (
			input: TaskWorkspaceContextInput,
		) {
			return yield* degrade(input.taskId, Cache.get(cache, input.taskId))
		})

		return TaskWorkspaceContext.of({ loadTaskWorkspaceContext, recentTaskWorkspaceContext })
	}),
)
