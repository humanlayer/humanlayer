import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'

export class DirectoryPickerFailure extends Data.TaggedError('DirectoryPickerFailure')<{
	readonly cause: unknown
}> {}

export interface DirectoryPickerShape {
	readonly pickDirectory: Effect.Effect<string | null, DirectoryPickerFailure>
}

export class DirectoryPicker extends Context.Service<DirectoryPicker, DirectoryPickerShape>()('DirectoryPicker') {}
