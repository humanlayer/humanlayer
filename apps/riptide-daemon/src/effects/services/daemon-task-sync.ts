import { Context, Data, Effect, Layer } from 'effect'

import { Sentry } from '@/instrument'
import type { ISyncService, ITaskSyncContext } from '@/lib/sync-service'

export class DaemonTaskSyncError extends Data.TaggedError('DaemonTaskSyncError')<{
	readonly taskId: string
	readonly cause: unknown
}> {}

export class DaemonTaskSync extends Context.Service<
	DaemonTaskSync,
	{
		readonly ensureTaskSync: (input: {
			readonly taskId: string
			readonly workingDirectory: string
		}) => Effect.Effect<ITaskSyncContext, DaemonTaskSyncError>
	}
>()('DaemonTaskSync') {}

export const DaemonTaskSyncLive = (syncService: ISyncService) =>
	Layer.succeed(DaemonTaskSync, {
		ensureTaskSync: ({ taskId, workingDirectory }) =>
			Effect.tryPromise({
				try: () => syncService.ensureTaskSync(taskId, workingDirectory),
				catch: (cause) => new DaemonTaskSyncError({ taskId, cause }),
			}).pipe(
				Effect.tapError(Effect.logError),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.withSpan('daemon.task_sync.ensure', { attributes: { task_id: taskId } }),
			),
	})
