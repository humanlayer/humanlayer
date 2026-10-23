import { Config, Context, Data, Effect, Layer, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

const TaskDiffStreamKindSchema = Schema.Literals(['files', 'patches', 'file-versions'])
type TaskDiffStreamKind = typeof TaskDiffStreamKindSchema.Type

const DeleteTaskDiffStreamsInputSchema = Schema.Struct({
	organizationId: Schema.NonEmptyString,
	taskId: Schema.NonEmptyString,
})
type DeleteTaskDiffStreamsInput = typeof DeleteTaskDiffStreamsInputSchema.Type

class TaskDiffStreamDeleteError extends Data.TaggedError('TaskDiffStreamDeleteError')<{
	readonly stream: TaskDiffStreamKind
	readonly cause: unknown
}> {}

/** Owns task-diff durable stream operations. */
export class TaskDiffService extends Context.Service<
	TaskDiffService,
	{
		/** Best-effort deletion of every durable stream owned by a task diff, from both protocol generations. */
		readonly deleteTaskDiffStreams: (input: DeleteTaskDiffStreamsInput) => Effect.Effect<void>
	}
>()('TaskDiffService') {}

const deleteStream = (
	origin: string,
	client: HttpClient.HttpClient,
	input: DeleteTaskDiffStreamsInput,
	stream: TaskDiffStreamKind,
) => {
	const attributes = { organization_id: input.organizationId, task_id: input.taskId, stream }
	const url = new URL(
		`${origin}/v1/stream/organizations/${encodeURIComponent(input.organizationId)}/tasks/${encodeURIComponent(input.taskId)}/diff-${stream}`,
	)

	return client.execute(HttpClientRequest.delete(url)).pipe(
		Effect.flatMap((response) =>
			response.status === 404 ? Effect.void : HttpClientResponse.filterStatusOk(response).pipe(Effect.asVoid),
		),
		Effect.mapError((cause) => new TaskDiffStreamDeleteError({ stream, cause })),
		Effect.tapError((error) =>
			Effect.logWarning('Task diff stream deletion failed', error).pipe(Effect.annotateLogs(attributes)),
		),
		Effect.catchTag('TaskDiffStreamDeleteError', () => Effect.void),
		Effect.withSpan('task_diff.delete_stream', { attributes }),
	)
}

export const TaskDiffServiceLive = Layer.effect(
	TaskDiffService,
	Effect.gen(function* () {
		const origin = (yield* Config.URL('DURABLE_STREAMS_ORIGIN')).href.replace(/\/+$/, '')
		const client = yield* HttpClient.HttpClient

		return TaskDiffService.of({
			deleteTaskDiffStreams: (input) => {
				const attributes = { organization_id: input.organizationId, task_id: input.taskId }
				return Effect.all(
					[
						deleteStream(origin, client, input, 'files'),
						deleteStream(origin, client, input, 'patches'),
						deleteStream(origin, client, input, 'file-versions'),
					],
					{ concurrency: 3, discard: true },
				).pipe(Effect.withSpan('task_diff.delete_task_diff_streams', { attributes }))
			},
		})
	}),
)
