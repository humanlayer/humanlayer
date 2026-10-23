import { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Data from 'effect/Data'
import * as Schema from 'effect/Schema'

export class DaemonInstanceAlreadyRunning extends Schema.TaggedError<DaemonInstanceAlreadyRunning>()(
	'DaemonInstanceAlreadyRunning',
	{
		userId: Schema.String,
		organizationId: Schema.String,
		hostId: Schema.String,
		stage: DaemonStage,
		lockPath: Schema.String,
	},
) {}

export class DaemonInstanceLockError extends Data.TaggedError('DaemonInstanceLockError')<{
	readonly cause: unknown
	readonly message: string
}> {}
