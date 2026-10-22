import { DurableStream, DurableStreamError, IdempotentProducer } from '@durable-streams/client'
import { DURABLE_STREAM_CREATE_BACKOFF_OPTIONS } from '@humanlayer/streams/config'
import {
	encodeCheckEnvelope,
	encodePullRequestEnvelope,
	type PrStatusKey,
	prStatusStreamPath,
} from '@humanlayer/streams/pr-status'
import { DateTime, Duration, Effect, Layer, Predicate } from 'effect'
import { uuidv7 } from 'uuidv7'

import { Sentry } from '../../../instrument'
import { DurableStreamsConfig } from '../durable-streams/durable-streams-config.service'
import {
	PrStatusStream,
	PrStatusStreamAppendError,
	PrStatusStreamInitializationError,
	type PrStatusStreamShape,
} from './pr-status-stream.service'

const streamUrl = (origin: string, key: PrStatusKey) => `${origin}/v1/stream${prStatusStreamPath(key)}`

const keyAttributes = (key: PrStatusKey) => ({
	organization_id: key.organizationId,
	repo_full_name: key.repoFullName,
	branch: key.branch,
})

// The server dedupes on `(stream, producerId, epoch, seq)` and every append restarts seq at 0, so
// a stable id would make every write after the first look like a replay.
const producerId = (key: PrStatusKey) =>
	`riptide-api:pr-status:${key.organizationId}:${key.repoFullName.toLowerCase()}:${key.branch}:${uuidv7()}`

const isStreamAlreadyCreated: Predicate.Predicate<unknown> = (cause) =>
	cause instanceof DurableStreamError && cause.code === 'CONFLICT_EXISTS'

const withTimeout = <A, E>(effect: Effect.Effect<A, E>, onTimeout: () => E) =>
	effect.pipe(
		Effect.timeout(Duration.seconds(5)),
		Effect.catchTag('TimeoutError', () => Effect.fail(onTimeout())),
	)

export const PrStatusStreamLive = Layer.effect(
	PrStatusStream,
	Effect.gen(function* () {
		const config = yield* DurableStreamsConfig

		const head = (key: PrStatusKey) =>
			withTimeout(
				Effect.tryPromise({
					// Without the signal the fiber is interrupted but the request stays open on
					// undici's 300s header timeout.
					try: (signal) => fetch(streamUrl(config.origin, key), { method: 'HEAD', signal }),
					catch: (cause) =>
						new PrStatusStreamInitializationError({ message: 'Failed to check PR status stream', cause }),
				}),
				() =>
					new PrStatusStreamInitializationError({
						message: 'PR status stream HEAD timed out after 5s',
						cause: 'timeout',
					}),
			).pipe(
				Effect.map((response) => response.ok),
				Effect.catchCause((cause) =>
					Effect.logWarning('PR status stream HEAD failed').pipe(
						Effect.annotateLogs({ ...keyAttributes(key), cause: String(cause) }),
						Effect.as(false),
					),
				),
				Effect.withSpan('pr_status_stream.head', { attributes: keyAttributes(key) }),
			)

		const create = (key: PrStatusKey) =>
			Effect.tryPromise({
				try: (signal) => {
					const stream = new DurableStream({
						url: streamUrl(config.origin, key),
						contentType: config.contentType,
						backoffOptions: DURABLE_STREAM_CREATE_BACKOFF_OPTIONS,
						signal,
					})
					return stream.create({ ttlSeconds: config.ttlSeconds })
				},
				catch: (cause) =>
					new PrStatusStreamInitializationError({ message: 'Failed to create PR status stream', cause }),
			}).pipe(
				Effect.catchTag('PrStatusStreamInitializationError', (error) =>
					isStreamAlreadyCreated(error.cause) ? Effect.void : Effect.fail(error),
				),
				Effect.tapError((error) =>
					Effect.logError('PR status stream create failed').pipe(
						Effect.annotateLogs({ ...keyAttributes(key), cause: String(error.cause) }),
					),
				),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.asVoid,
				Effect.withSpan('pr_status_stream.create', { attributes: keyAttributes(key) }),
			)

		const appendEnvelopes = (key: PrStatusKey, encode: (appendedAt: string) => ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const appendedAt = DateTime.formatIso(yield* DateTime.now)
				const envelopes = encode(appendedAt)
				if (envelopes.length === 0) return
				// `append()` is fire-and-forget and routes a rejected POST to `onError` rather than
				// the queue, so `flush()` resolves even after a failed write.
				let batchFailure: Error | null = null
				const producer = yield* Effect.try({
					try: () => {
						const handle = new DurableStream({
							url: streamUrl(config.origin, key),
							contentType: config.contentType,
						})
						const created = new IdempotentProducer(handle, producerId(key), {
							epoch: 0,
							autoClaim: false,
							lingerMs: 0,
							maxInFlight: 1,
							onError: (error) => {
								batchFailure ??= error
							},
						})
						for (const envelope of envelopes) created.append(envelope)
						return created
					},
					catch: (cause) =>
						new PrStatusStreamAppendError({ message: 'Failed to append PR status row', cause }),
				})
				const detach = withTimeout(
					Effect.tryPromise({
						try: () => producer.detach(),
						catch: (cause) =>
							new PrStatusStreamAppendError({
								message: 'Failed to detach PR status producer',
								cause,
							}),
					}),
					() =>
						new PrStatusStreamAppendError({
							message: 'PR status producer detach timed out after 5s',
							cause: 'timeout',
						}),
				)
				const flush = withTimeout(
					Effect.tryPromise({
						try: () => producer.flush(),
						catch: (cause) =>
							new PrStatusStreamAppendError({ message: 'Failed to flush PR status row', cause }),
					}),
					() =>
						new PrStatusStreamAppendError({
							message: 'PR status flush timed out after 5s',
							cause: 'timeout',
						}),
				)
				yield* flush.pipe(
					Effect.catch((flushError) => detach.pipe(Effect.ignore, Effect.andThen(Effect.fail(flushError)))),
					Effect.andThen(
						detach.pipe(
							Effect.tapError((error) =>
								Effect.logWarning('PR status stream detach failed after a successful flush').pipe(
									Effect.annotateLogs({ ...keyAttributes(key), cause: String(error.cause) }),
								),
							),
							Effect.ignore,
						),
					),
				)
				if (batchFailure !== null) {
					return yield* Effect.fail(
						new PrStatusStreamAppendError({
							message: 'PR status batch was rejected by the stream server',
							cause: batchFailure,
						}),
					)
				}
			}).pipe(
				Effect.asVoid,
				Effect.tapError((error) =>
					Effect.logError('PR status append failed').pipe(
						Effect.annotateLogs({ ...keyAttributes(key), message: error.message }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { integration: 'github', error_type: 'pr_status_stream_append' },
									extra: keyAttributes(key),
								}),
							),
						),
					),
				),
			)

		const hydrate: PrStatusStreamShape['hydrate'] = (key, snapshot) =>
			Effect.gen(function* () {
				if (!(yield* head(key))) yield* create(key)
				yield* appendEnvelopes(key, (appendedAt) =>
					snapshot.pullRequest === null
						? []
						: [
								encodePullRequestEnvelope(snapshot.pullRequest, appendedAt),
								...snapshot.checks.map((row) => encodeCheckEnvelope(row, appendedAt)),
							],
				)
			}).pipe(
				Effect.withSpan('pr_status_stream.hydrate', {
					attributes: { ...keyAttributes(key), check_count: snapshot.checks.length },
				}),
			)

		const publishChecks: PrStatusStreamShape['publishChecks'] = (key, rows) =>
			Effect.gen(function* () {
				if (rows.length === 0) return
				if (!(yield* head(key))) return
				yield* appendEnvelopes(key, (appendedAt) => rows.map((row) => encodeCheckEnvelope(row, appendedAt)))
			}).pipe(
				Effect.withSpan('pr_status_stream.publish_checks', {
					attributes: { ...keyAttributes(key), check_count: rows.length },
				}),
			)

		const publishPullRequest: PrStatusStreamShape['publishPullRequest'] = (key, row) =>
			Effect.gen(function* () {
				if (!(yield* head(key))) return
				yield* appendEnvelopes(key, (appendedAt) => [encodePullRequestEnvelope(row, appendedAt)])
			}).pipe(
				Effect.withSpan('pr_status_stream.publish_pull_request', {
					attributes: { ...keyAttributes(key), number: row.number },
				}),
			)

		return PrStatusStream.of({ hydrate, publishChecks, publishPullRequest })
	}),
)
