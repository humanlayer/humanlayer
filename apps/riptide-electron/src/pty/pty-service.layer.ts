import {
	PtyCreateError,
	PtyNotFoundError,
	PtyOperationError,
	type PtyTransportEvent,
} from '@humanlayer/riptide-electron-rpc'
import * as Crypto from 'effect/Crypto'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import { spawn, type IDisposable, type IPty } from 'node-pty'

import { loadInteractiveShellEnvironment } from '../diagnostics/child-process-output'
import { Sentry } from '../instrument'
import { PtyService, type CreatePtyInput, type PtyIdInput } from './pty-service'
import { terminatePty } from './pty-signaling'

const DETACHED_REPLAY_CAPACITY = 64 * 1024
const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 24

interface PtyAttachment {
	readonly id: string
	readonly emit: (event: PtyTransportEvent) => void
	readonly end: () => void
}

interface PtySession {
	readonly process: IPty
	readonly writeSemaphore: Semaphore.Semaphore
	readonly dataListener: IDisposable
	readonly exitListener: IDisposable
	readonly replay: Array<number>
	attachment: PtyAttachment | undefined
	exitCode: number | null | undefined
	disposed: boolean
}

const processEnvironment = (): Record<string, string> =>
	Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))

const expandHome = (value: string, environment: Readonly<Record<string, string>>): string => {
	if (value === '~') return environment.HOME ?? value
	if (value.startsWith('~/') && environment.HOME !== undefined) return `${environment.HOME}/${value.slice(2)}`
	return value
}

const appendReplay = (session: PtySession, data: ReadonlyArray<number>): void => {
	if (data.length >= DETACHED_REPLAY_CAPACITY) {
		session.replay.splice(0, session.replay.length, ...data.slice(-DETACHED_REPLAY_CAPACITY))
		return
	}
	const overflow = session.replay.length + data.length - DETACHED_REPLAY_CAPACITY
	if (overflow > 0) session.replay.splice(0, overflow)
	session.replay.push(...data)
}

const terminateSession = (ptyId: string, operation: 'kill' | 'shutdown', session: PtySession) =>
	session.exitCode !== undefined || session.disposed
		? Effect.void
		: terminatePty({
				ptyId,
				operation,
				signalProcessGroup: (signal) => process.kill(-session.process.pid, signal),
				signalPty: (signal) => session.process.kill(signal),
			})

const disposeSession = (session: PtySession): void => {
	session.disposed = true
	session.dataListener.dispose()
	session.exitListener.dispose()
	session.attachment?.end()
}

export const PtyServiceLive = Layer.effect(
	PtyService,
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		const sessions = new Map<string, PtySession>()
		let nextAttachmentId = 0
		const environment = yield* loadInteractiveShellEnvironment().pipe(
			Effect.tapError((error) => Effect.logWarning('Interactive shell environment unavailable for PTY', error)),
			Effect.catchTag('CliProcessFailure', () => Effect.succeed(processEnvironment())),
		)

		const getSession = (input: PtyIdInput) => {
			const session = sessions.get(input.ptyId)
			return session === undefined
				? Effect.fail(new PtyNotFoundError({ ptyId: input.ptyId, message: `PTY ${input.ptyId} was not found` }))
				: Effect.succeed(session)
		}

		const create = (input: CreatePtyInput) =>
			Effect.gen(function* () {
				const ptyId = yield* crypto.randomUUIDv4.pipe(
					Effect.tapError((e) => Effect.logError(e)),
					Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
					Effect.mapError((error) => new PtyCreateError({ message: error.message })),
				)
				const executable = environment.SHELL ?? '/bin/zsh'
				const childEnvironment = { ...environment }
				if (childEnvironment.TERM === undefined) childEnvironment.TERM = 'xterm-256color'
				const columns = DEFAULT_COLUMNS
				const rows = DEFAULT_ROWS
				const writeSemaphore = yield* Semaphore.make(1)

				const child = yield* Effect.try({
					try: () =>
						spawn(executable, [], {
							name: childEnvironment.TERM,
							cols: columns,
							rows,
							cwd: expandHome(input.cwd, environment),
							env: childEnvironment,
						}),
					catch: (error) => {
						Sentry.captureException(error)
						return new PtyCreateError({
							message: error instanceof Error ? error.message : `Failed to spawn ${executable}`,
						})
					},
				}).pipe(Effect.tapError((e) => Effect.logError(e)))

				const session: PtySession = {
					process: child,
					writeSemaphore,
					dataListener: { dispose: () => undefined },
					exitListener: { dispose: () => undefined },
					replay: [],
					attachment: undefined,
					exitCode: undefined,
					disposed: false,
				}
				const dataListener = child.onData((contents) => {
					if (session.disposed) return
					const data = Array.from(new TextEncoder().encode(contents))
					if (session.attachment !== undefined) {
						session.attachment.emit({ event: 'output', data: { data } })
					} else {
						appendReplay(session, data)
					}
				})
				const exitListener = child.onExit(({ exitCode }) => {
					if (session.disposed) return
					session.exitCode = exitCode
					session.attachment?.emit({ event: 'exit', data: { code: exitCode } })
					session.attachment?.end()
					session.attachment = undefined
				})
				Object.assign(session, { dataListener, exitListener })
				sessions.set(ptyId, session)
				yield* Effect.logInfo('Electron PTY created').pipe(
					Effect.annotateLogs({ pty_id: ptyId, executable, columns, rows }),
				)
				return ptyId
			}).pipe(Effect.withSpan('pty.create'))

		const attach = (input: PtyIdInput) =>
			Stream.unwrap(
				Effect.gen(function* () {
					const session = yield* getSession(input)
					const attachmentId = `attachment-${++nextAttachmentId}`
					return Stream.callback<PtyTransportEvent>((queue) =>
						Effect.acquireRelease(
							Effect.sync(() => {
								session.attachment?.end()
								const attachment: PtyAttachment = {
									id: attachmentId,
									emit: (event) => Queue.offerUnsafe(queue, event),
									end: () => Queue.endUnsafe(queue),
								}
								session.attachment = attachment
								attachment.emit({ event: 'attached' })
								if (session.replay.length > 0) {
									attachment.emit({ event: 'output', data: { data: session.replay.splice(0) } })
								}
								if (session.exitCode !== undefined) {
									attachment.emit({ event: 'exit', data: { code: session.exitCode } })
									attachment.end()
								}
							}),
							() =>
								Effect.sync(() => {
									if (session.attachment?.id === attachmentId) session.attachment = undefined
								}),
						),
					)
				}),
			).pipe(Stream.withSpan('pty.attach'))

		const detach = Effect.fn('pty.detach')(function* (input: PtyIdInput) {
			const session = yield* getSession(input)
			session.attachment?.end()
			session.attachment = undefined
		})

		const write = Effect.fn('pty.write')(function* (input: { ptyId: string; data: ReadonlyArray<number> }) {
			const session = yield* getSession(input)
			yield* session.writeSemaphore.withPermit(
				Effect.try({
					try: () => session.process.write(Buffer.from(input.data)),
					catch: (error) => {
						Sentry.captureException(error)
						return new PtyOperationError({
							ptyId: input.ptyId,
							operation: 'write',
							message: error instanceof Error ? error.message : 'Failed to write PTY input',
						})
					},
				}).pipe(Effect.tapError((e) => Effect.logError(e))),
			)
		})

		const resize = Effect.fn('pty.resize')(function* (input: { ptyId: string; cols: number; rows: number }) {
			const session = yield* getSession(input)
			if (input.cols <= 0 || input.rows <= 0) {
				return yield* Effect.fail(
					new PtyOperationError({
						ptyId: input.ptyId,
						operation: 'resize',
						message: 'PTY dimensions must be positive',
					}),
				)
			}
			yield* Effect.try({
				try: () => session.process.resize(Math.floor(input.cols), Math.floor(input.rows)),
				catch: (error) => {
					Sentry.captureException(error)
					return new PtyOperationError({
						ptyId: input.ptyId,
						operation: 'resize',
						message: error instanceof Error ? error.message : 'Failed to resize PTY',
					})
				},
			}).pipe(Effect.tapError((e) => Effect.logError(e)))
		})

		const kill = Effect.fn('pty.kill')(function* (input: PtyIdInput) {
			const session = yield* getSession(input)
			yield* terminateSession(input.ptyId, 'kill', session).pipe(
				Effect.tapError((error) =>
					Effect.logError('Failed to kill Electron PTY', error).pipe(
						Effect.annotateLogs({ pty_id: input.ptyId, operation: 'kill', signal: error.signal }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { pty_id: input.ptyId, operation: 'kill', signal: error.signal },
								}),
							),
						),
					),
				),
				Effect.mapError(
					(error) =>
						new PtyOperationError({
							ptyId: input.ptyId,
							operation: 'kill',
							message: `Failed to terminate PTY with ${error.signal}`,
						}),
				),
			)
			disposeSession(session)
			sessions.delete(input.ptyId)
		})

		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				Array.from(sessions.entries()),
				([ptyId, session]) =>
					terminateSession(ptyId, 'shutdown', session).pipe(
						Effect.tapError((error) =>
							Effect.logError('Failed to terminate Electron PTY during shutdown', error).pipe(
								Effect.annotateLogs({ pty_id: ptyId, operation: 'shutdown', signal: error.signal }),
								Effect.andThen(
									Effect.sync(() =>
										Sentry.captureException(error, {
											tags: { pty_id: ptyId, operation: 'shutdown', signal: error.signal },
										}),
									),
								),
							),
						),
						Effect.catchTag('PtyTerminationError', () => Effect.void),
						Effect.andThen(Effect.sync(() => disposeSession(session))),
					),
				{ discard: true },
			).pipe(Effect.andThen(Effect.sync(() => sessions.clear()))),
		)

		return PtyService.of({
			create,
			attach,
			detach,
			write,
			resize,
			kill,
			list: Effect.sync(() => Array.from(sessions.keys())).pipe(Effect.withSpan('pty.list')),
		})
	}),
)
