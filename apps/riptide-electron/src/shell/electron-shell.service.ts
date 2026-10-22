import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'

export class ElectronShellFailure extends Data.TaggedError('ElectronShellFailure')<{
	readonly cause: unknown
	readonly message: string
}> {}

export interface ElectronShellShape {
	readonly openExternal: (input: { readonly url: string }) => Effect.Effect<void, ElectronShellFailure>
}

export class ElectronShell extends Context.Service<ElectronShell, ElectronShellShape>()('ElectronShell') {}
