import type {
	PtyCreateError,
	PtyNotFoundError,
	PtyOperationError,
	PtySize,
	PtyTransportEvent,
} from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Stream from 'effect/Stream'

export interface CreatePtyInput {
	readonly cwd: string
}

export interface PtyIdInput {
	readonly ptyId: string
}

export interface WritePtyInput extends PtyIdInput {
	readonly data: ReadonlyArray<number>
}

export interface ResizePtyInput extends PtyIdInput, PtySize {}

export interface PtyServiceShape {
	readonly create: (input: CreatePtyInput) => Effect.Effect<string, PtyCreateError>
	readonly attach: (input: PtyIdInput) => Stream.Stream<PtyTransportEvent, PtyNotFoundError>
	readonly detach: (input: PtyIdInput) => Effect.Effect<void, PtyNotFoundError>
	readonly write: (input: WritePtyInput) => Effect.Effect<void, PtyNotFoundError | PtyOperationError>
	readonly resize: (input: ResizePtyInput) => Effect.Effect<void, PtyNotFoundError | PtyOperationError>
	readonly kill: (input: PtyIdInput) => Effect.Effect<void, PtyNotFoundError | PtyOperationError>
	readonly list: Effect.Effect<ReadonlyArray<string>>
}

export class PtyService extends Context.Service<PtyService, PtyServiceShape>()('PtyService') {}
