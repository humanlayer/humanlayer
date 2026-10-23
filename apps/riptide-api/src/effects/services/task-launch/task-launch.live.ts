import { Effect, Layer } from 'effect'

import { Sentry } from '../../../instrument'
import { PostgresDbQueryError, PostgresDbTransactionError } from '../postgres/postgres-db.errors'
import { SessionTitleGeneration } from '../session-title-generation/session-title-generation.service'
import { TaskIntentClassifier } from '../task-intent-classifier/task-intent-classifier.service'
import { TaskLaunchUnavailable } from './task-launch.errors'
import { launchTaskDraftPersistence } from './task-launch.persistence'
import { TaskLaunchService } from './task-launch.service'

export const TaskLaunchServiceLive = Layer.succeed(TaskLaunchService, {
	launchTaskDraft: (input) => {
		const attributes = {
			draft_id: input.draftId,
			organization_id: input.organizationId,
			first_session_id: input.firstSession.id,
		}
		const launch = Effect.gen(function* () {
			const taskIntentClassifier = yield* TaskIntentClassifier
			const intent =
				input.firstSession.intent ??
				(input.workflowType === 'freeform'
					? yield* taskIntentClassifier.classify(input.firstSession.text)
					: undefined)
			const result = yield* launchTaskDraftPersistence({ ...input, intent })
			if (
				result.outcome !== 'already-launched' &&
				!input.firstSession.title?.trim() &&
				input.firstSession.text.trim()
			) {
				const titleGeneration = yield* SessionTitleGeneration
				yield* titleGeneration.scheduleGeneration({
					sessionId: result.firstSessionId,
					organizationId: input.organizationId,
					userId: input.userId,
					prompt: input.firstSession.text,
					ticketId: result.task.ticket_id,
					taskName: result.task.name,
				})
			}
			return result
		})
		return launch.pipe(
			Effect.tapError((error) =>
				Effect.logError('Task draft launch failed', error).pipe(Effect.annotateLogs(attributes)),
			),
			Effect.tapError((error) =>
				Effect.sync(() =>
					Sentry.captureException(error, { tags: { error_type: error._tag }, extra: attributes }),
				),
			),
			Effect.catch((error) => {
				if (error instanceof PostgresDbQueryError || error instanceof PostgresDbTransactionError) {
					return Effect.fail(new TaskLaunchUnavailable({ draftId: input.draftId, cause: error }))
				}
				return Effect.fail(error)
			}),
			Effect.withSpan('task_launch.launch_task_draft', { attributes }),
		)
	},
})
