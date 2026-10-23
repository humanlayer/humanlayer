import { query as claudeQuery, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/bun'
import { Duration, Effect, Layer, Option, Stream } from 'effect'

import { ClaudeSdkError } from './claude-sdk-error'
import { ClaudeSdk, type OpenClaudeSdkSessionInput } from './claude-sdk-session.service'

export type ClaudeQueryFactory = typeof claudeQuery

// Leave time inside the process-wide five-second shutdown budget for the query close,
// remaining session finalizers, host notification, and runtime disposal.
const gracefulInterruptTimeout = Duration.seconds(2)

const interruptAndCloseQuery = (sdkQuery: Query, sessionId: string) =>
	Effect.gen(function* () {
		const [interruptDuration, interrupted] = yield* Effect.tryPromise({
			try: () => sdkQuery.interrupt(),
			catch: (cause) => new ClaudeSdkError({ operation: 'interrupt', cause }),
		}).pipe(
			Effect.tapError((error) =>
				Effect.logWarning('Graceful Claude SDK interruption failed').pipe(
					Effect.annotateLogs({ session_id: sessionId, cause: error }),
					Effect.andThen(
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'claude_sdk_interrupt_failed', session_id: sessionId },
							}),
						),
					),
				),
			),
			Effect.ignore,
			Effect.interruptible,
			Effect.timeoutOption(gracefulInterruptTimeout),
			Effect.timed,
		)
		if (Option.isNone(interrupted)) {
			const interruptDurationMs = Duration.toMillis(interruptDuration)
			yield* Effect.logWarning('Graceful Claude SDK interruption timed out; forcing query closed').pipe(
				Effect.annotateLogs({
					session_id: sessionId,
					interrupt_duration_ms: interruptDurationMs,
					interrupt_timeout_ms: Duration.toMillis(gracefulInterruptTimeout),
				}),
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureMessage('Graceful Claude SDK interruption timed out', {
							level: 'warning',
							tags: { error_type: 'claude_sdk_interrupt_timeout', session_id: sessionId },
							extra: { interruptDurationMs },
						}),
					),
				),
			)
		}
	}).pipe(
		Effect.ensuring(
			Effect.sync(() => sdkQuery.close()).pipe(
				Effect.andThen(
					Effect.logInfo('Claude SDK query closed').pipe(Effect.annotateLogs({ session_id: sessionId })),
				),
			),
		),
		Effect.withSpan('claude.sdk.interrupt_and_close', { attributes: { session_id: sessionId } }),
	)

// The SDK marks this control experimental and will rename it; every caller goes through here.
// skipBehaviors skips a scan of every transcript from the last seven days that only fills a section the daemon ignores.
const readSdkUsage = (sdkQuery: Query) =>
	typeof sdkQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET === 'function'
		? sdkQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
		: Promise.resolve(undefined)

function openQuery(query: ClaudeQueryFactory, input: OpenClaudeSdkSessionInput) {
	const makeUserMessage = (message: string): SDKUserMessage => ({
		type: 'user',
		session_id: '',
		parent_tool_use_id: null,
		message: { role: 'user', content: message },
	})
	const pending: SDKUserMessage[] = [makeUserMessage(input.prompt)]
	// Resolver for the prompt iterator's current empty-mailbox wait. Sending or closing
	// resolves and clears it so the iterator can consume new input or observe EOF.
	let wake: (() => void) | undefined
	let closed = false
	let completed = false
	let terminationStarted = false

	const closeInput = () => {
		if (closed) return
		closed = true
		wake?.()
		wake = undefined
	}

	const sendMessage = (message: string) =>
		Effect.suspend(() => {
			if (closed) {
				return Effect.fail(
					new ClaudeSdkError({ operation: 'sendMessage', cause: new Error('Claude SDK input is closed') }),
				)
			}
			return Effect.sync(() => {
				pending.push(makeUserMessage(message))
				wake?.()
				wake = undefined
			})
		})

	async function* prompt(): AsyncIterable<SDKUserMessage> {
		while (!closed || pending.length > 0) {
			if (pending.length === 0) {
				await new Promise<void>((resolve) => {
					if (closed) resolve()
					else wake = resolve
				})
			}
			while (pending.length > 0) {
				const message = pending.shift()
				if (message) yield message
			}
		}
	}

	const sdkQuery = query({
		prompt: prompt(),
		options: input.options,
	})
	const interruptAndClose = Effect.suspend(() => {
		if (terminationStarted) return Effect.void
		terminationStarted = true
		return interruptAndCloseQuery(sdkQuery, input.sessionId)
	})

	return {
		sdkQuery,
		closeInput,
		sendMessage,
		isCompleted: () => completed,
		markCompleted: () => {
			completed = true
		},
		interruptAndClose,
	}
}

export function makeClaudeSdkLive(query: ClaudeQueryFactory) {
	return Layer.succeed(ClaudeSdk, {
		open: (input) =>
			Effect.acquireRelease(
				Effect.try({
					try: () => openQuery(query, input),
					catch: (cause) => new ClaudeSdkError({ operation: 'open', cause }),
				}),
				(resource) =>
					Effect.gen(function* () {
						resource.closeInput()
						if (!resource.isCompleted()) {
							yield* resource.interruptAndClose
						}
					}),
			).pipe(
				Effect.map((resource) => ({
					output: Stream.fromAsyncIterable(
						resource.sdkQuery as Query,
						(cause) => new ClaudeSdkError({ operation: 'output', cause }),
					),
					input: {
						sendMessage: resource.sendMessage,
						close: Effect.sync(resource.closeInput),
					},
					controls: {
						interrupt: resource.interruptAndClose,
						setModel: (model) =>
							Effect.tryPromise({
								try: () => resource.sdkQuery.setModel(model),
								catch: (cause) => new ClaudeSdkError({ operation: 'setModel', cause }),
							}),
						setPermissionMode: (mode) =>
							Effect.tryPromise({
								try: () => resource.sdkQuery.setPermissionMode(mode),
								catch: (cause) => new ClaudeSdkError({ operation: 'setPermissionMode', cause }),
							}),
						supportedCommands: Effect.tryPromise({
							try: () => resource.sdkQuery.supportedCommands(),
							catch: (cause) => new ClaudeSdkError({ operation: 'supportedCommands', cause }),
						}),
						readUsage: Effect.tryPromise({
							try: () => readSdkUsage(resource.sdkQuery),
							catch: (cause) => new ClaudeSdkError({ operation: 'readUsage', cause }),
						}),
					},
					markCompleted: Effect.sync(resource.markCompleted),
				})),
			),
	})
}

export const ClaudeSdkLive = makeClaudeSdkLive(claudeQuery)
