import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'
import type { ChildProcessSpawner } from 'effect/process'

export class HumanLayerCliUpdateFailure extends Data.TaggedError('HumanLayerCliUpdateFailure')<{
	readonly cause: unknown
	readonly message: string
}> {}

export interface HumanLayerCliShape {
	readonly updateToLatest: Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner>
}

export class HumanLayerCli extends Context.Service<HumanLayerCli, HumanLayerCliShape>()('HumanLayerCli') {}
