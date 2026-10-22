import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export class DirectoryPickerOperationError extends Schema.TaggedError<DirectoryPickerOperationError>()(
	'DirectoryPickerOperationError',
	{
		message: Schema.String,
	},
) {}

export class PickDirectory extends Rpc.make('PickDirectory', {
	success: Schema.NullOr(Schema.String),
	error: DirectoryPickerOperationError,
}) {}
