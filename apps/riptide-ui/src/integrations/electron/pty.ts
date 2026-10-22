import type { PtyEvent, PtyNotFoundError } from '@humanlayer/riptide-electron-rpc'
import * as Data from 'effect/Data'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import * as Stream from 'effect/Stream'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

interface ActiveAttachment {
	readonly token: symbol
	readonly fiber: Fiber.Fiber<void, never>
}

const activeAttachments = new Map<string, ActiveAttachment>()

export function createPty(cwd: string): Promise<string> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.CreatePty({ cwd })))
}

export async function attachPty(ptyId: string, onEvent: (event: PtyEvent) => void): Promise<void> {
	const active = activeAttachments.get(ptyId)
	if (active !== undefined) electronClientRuntime.runFork(Fiber.interrupt(active.fiber))

	const token = Symbol(ptyId)
	const attachmentReady = electronClientRuntime.runSync(
		Deferred.make<void, PtyNotFoundError | RpcClientError | PtyAttachmentEndedError>(),
	)
	let acknowledged = false
	const fiber = electronClientRuntime.runFork(
		Effect.gen(function* () {
			const client = yield* ElectronRpcClient
			yield* client.AttachPty({ ptyId }).pipe(
				Stream.runForEach((event) =>
					Effect.sync(() => {
						if (event.event === 'attached') {
							acknowledged = true
							electronClientRuntime.runFork(Deferred.succeed(attachmentReady, undefined))
							return
						}
						onEvent(event)
					}),
				),
			)
		}).pipe(
			Effect.catchTags({
				PtyNotFoundError: (error) => Deferred.fail(attachmentReady, error).pipe(Effect.asVoid),
				RpcClientError: (error) =>
					Effect.sync(() => {
						logger.error('Electron PTY attachment stream failed', { ptyId, error, acknowledged })
						captureException(error, { tags: { operation: 'pty.attach_stream', pty_id: ptyId } })
					}).pipe(Effect.andThen(Deferred.fail(attachmentReady, error)), Effect.asVoid),
			}),
			Effect.ensuring(
				Effect.sync(() => {
					Deferred.doneUnsafe(attachmentReady, Effect.fail(new PtyAttachmentEndedError({ ptyId })))
					if (activeAttachments.get(ptyId)?.token === token) activeAttachments.delete(ptyId)
				}),
			),
		),
	)
	activeAttachments.set(ptyId, { token, fiber })
	await electronClientRuntime.runPromise(Deferred.await(attachmentReady))
}

class PtyAttachmentEndedError extends Data.TaggedError('PtyAttachmentEndedError')<{
	readonly ptyId: string
}> {}

export async function detachPty(ptyId: string): Promise<void> {
	const active = activeAttachments.get(ptyId)
	activeAttachments.delete(ptyId)
	if (active !== undefined) await electronClientRuntime.runPromise(Fiber.interrupt(active.fiber))
	await electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.DetachPty({ ptyId })))
}

export function writePty(ptyId: string, data: Uint8Array): Promise<void> {
	return electronClientRuntime.runPromise(
		ElectronRpcClient.use((client) => client.WritePty({ ptyId, data: Array.from(data) })),
	)
}

export function resizePty(ptyId: string, cols: number, rows: number): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ResizePty({ ptyId, cols, rows })))
}

export async function killPty(ptyId: string): Promise<void> {
	const active = activeAttachments.get(ptyId)
	activeAttachments.delete(ptyId)
	if (active !== undefined) electronClientRuntime.runFork(Fiber.interrupt(active.fiber))
	await electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.KillPty({ ptyId })))
}

export function listPtys(): Promise<ReadonlyArray<string>> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ListPtys()))
}
