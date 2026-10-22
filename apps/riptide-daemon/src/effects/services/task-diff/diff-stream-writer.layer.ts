import { randomUUID } from 'node:crypto'

import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import { DURABLE_STREAM_CREATE_BACKOFF_OPTIONS, STREAM_CONFIG } from '@humanlayer/streams/config'
import { Config, Duration, Effect, Layer, Option } from 'effect'

import { DurableStreamFetch } from '../stream-producer/durable-stream-fetch'
import {
	DiffStreamWriterFactory,
	type DiffStreamAvailability,
	type DiffStreamWriter,
} from './diff-stream-writer.service'
import { StreamAppendError, StreamFlushError, StreamInitializationError } from './errors'
import { reportTaskDiffError } from './task-diff-observability'
import type { TaskDiffWorkspace } from './types'

const checkStreamExistence = (stream: DurableStream, name: 'versions' | 'files') =>
	Effect.tryPromise({
		try: async () => (await stream.head()).exists,
		catch: (cause) => new StreamInitializationError({ message: `Failed to check diff ${name} stream`, cause }),
	}).pipe(Effect.tapError((error) => reportTaskDiffError(error, 'writer.verify', { stream: name })))

const createStream = (stream: DurableStream, name: 'versions' | 'files') =>
	Effect.tryPromise({
		try: () => stream.create({ contentType: STREAM_CONFIG.contentType }),
		catch: (cause) => new StreamInitializationError({ message: `Failed to create diff ${name} stream`, cause }),
	}).pipe(Effect.tapError((error) => reportTaskDiffError(error, 'writer.initialize', { stream: name })))

const detachTimeout = Duration.seconds(1)
const flushTimeout = Duration.seconds(10)

const detachProducer = (producer: IdempotentProducer, stream: 'versions' | 'files') =>
	Effect.promise(() => producer.detach()).pipe(
		Effect.timeoutOption(detachTimeout),
		Effect.flatMap(
			Option.match({
				onNone: () =>
					Effect.logWarning('Task diff producer detach timed out').pipe(Effect.annotateLogs({ stream })),
				onSome: () => Effect.void,
			}),
		),
	)

/**
 * Wraps one IdempotentProducer per stream. The SDK reports a failed batch only through
 * `onError` and then keeps a sequence number the server will never accept again, so a failed
 * or hung flush replaces the producer with a fresh one and reports a StreamFlushError.
 */
const makeWriter = Effect.fn('task_diff.writer.make')(function* (
	stream: DurableStream,
	producerIdPrefix: string,
	name: 'versions' | 'files',
	fetch: typeof globalThis.fetch,
) {
	let failure: unknown
	const makeProducer = () =>
		new IdempotentProducer(stream, `${producerIdPrefix}:${name}:${randomUUID()}`, {
			maxInFlight: 1,
			fetch,
			onError: (error) => {
				failure = error
			},
		})
	let producer = makeProducer()
	yield* Effect.addFinalizer(() => detachProducer(producer, name).pipe(Effect.ignore))

	const replaceProducer = (cause: unknown) =>
		Effect.gen(function* () {
			const stale = producer
			failure = undefined
			producer = makeProducer()
			yield* Effect.logWarning('Replaced task diff producer after failed flush').pipe(
				Effect.annotateLogs({ stream: name, cause: String(cause) }),
			)
			yield* detachProducer(stale, name).pipe(Effect.ignore)
			return yield* Effect.fail(
				new StreamFlushError({ message: `Failed to flush diff ${name} stream`, stream: name, cause }),
			)
		})

	const writer: DiffStreamWriter = {
		append: (event) =>
			Effect.try({
				try: () => producer.append(event),
				catch: (cause) =>
					new StreamAppendError({ message: `Failed to append diff ${name} event`, stream: name, cause }),
			}).pipe(Effect.tapError((error) => reportTaskDiffError(error, 'writer.append', { stream: name }))),
		flush: Effect.suspend(() => {
			const flushing = producer
			return Effect.promise(() => flushing.flush()).pipe(
				Effect.timeoutOption(flushTimeout),
				Effect.flatMap((completed) => {
					if (Option.isNone(completed)) return replaceProducer('flush timed out')
					if (failure !== undefined) return replaceProducer(failure)
					return Effect.void
				}),
				Effect.tapError((error) => reportTaskDiffError(error, 'writer.flush', { stream: name })),
			)
		}),
	}
	return writer
})

export const DiffStreamWriterFactoryLive = Layer.effect(
	DiffStreamWriterFactory,
	Effect.gen(function* () {
		const proxyOrigin = yield* Config.String('RIPTIDE_SYNC_ORIGIN')
		const durableStreamFetch = yield* DurableStreamFetch

		const createTaskDiffWriterGeneration = (workspace: TaskDiffWorkspace) =>
			Effect.gen(function* () {
				const taskPath = `organizations/${workspace.organizationId}/tasks/${workspace.taskId}`
				const baseUrl = proxyOrigin.replace(/\/$/, '')
				const versionStream = new DurableStream({
					url: `${baseUrl}/v2/streams/${taskPath}/diff-file-versions`,
					contentType: STREAM_CONFIG.contentType,
					backoffOptions: DURABLE_STREAM_CREATE_BACKOFF_OPTIONS,
					fetch: durableStreamFetch.fetch,
				})
				const fileStream = new DurableStream({
					url: `${baseUrl}/v2/streams/${taskPath}/diff-files`,
					contentType: STREAM_CONFIG.contentType,
					backoffOptions: DURABLE_STREAM_CREATE_BACKOFF_OPTIONS,
					fetch: durableStreamFetch.fetch,
				})
				const checkVersionStreamExistence = checkStreamExistence(versionStream, 'versions')
				const checkFileListStreamExistence = checkStreamExistence(fileStream, 'files')
				const checkTaskDiffStreamExistence = Effect.all(
					[checkVersionStreamExistence, checkFileListStreamExistence],
					{ concurrency: 2 },
				).pipe(
					Effect.map(
						([versionsExist, filesExist]) =>
							({ versionsExist, filesExist }) satisfies DiffStreamAvailability,
					),
				)
				const createMissingTaskDiffStreams = (availability: DiffStreamAvailability) =>
					Effect.all(
						[
							availability.versionsExist ? Effect.void : createStream(versionStream, 'versions'),
							availability.filesExist ? Effect.void : createStream(fileStream, 'files'),
						],
						{ concurrency: 2, discard: true },
					)
				const availability = yield* checkTaskDiffStreamExistence
				yield* createMissingTaskDiffStreams(availability)

				const producerIdPrefix = `riptide-daemon:task-diff:${workspace.hostId}:${workspace.taskId}`
				const versions = yield* makeWriter(
					versionStream,
					producerIdPrefix,
					'versions',
					durableStreamFetch.fetch,
				)
				const files = yield* makeWriter(fileStream, producerIdPrefix, 'files', durableStreamFetch.fetch)

				return { versions, files, checkTaskDiffStreamExistence }
			}).pipe(Effect.withSpan('task_diff.writer.create', { attributes: { task_id: String(workspace.taskId) } }))

		return DiffStreamWriterFactory.of({
			create: createTaskDiffWriterGeneration,
		})
	}),
)
