import { Data } from 'effect'

export class StackSyncPlanError extends Data.TaggedError('StackSyncPlanError')<{
	readonly reason: string
	readonly cause?: unknown
}> {}

export class StackSyncApplyError extends Data.TaggedError('StackSyncApplyError')<{
	readonly action: string
	readonly actionIndex: number
	readonly reason: string
	readonly cause?: unknown
}> {}
