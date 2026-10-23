import { Data } from 'effect'

export class TaskLaunchConflict extends Data.TaggedError('TaskLaunchConflict')<{
	readonly draftId: string
	readonly reason: 'task-id-in-use' | 'slug-in-use'
}> {}

export class TaskLaunchForbidden extends Data.TaggedError('TaskLaunchForbidden')<{
	readonly draftId: string
	readonly organizationId: string
	readonly userId: string
}> {}

export class TaskLaunchUnavailable extends Data.TaggedError('TaskLaunchUnavailable')<{
	readonly draftId: string
	readonly cause: unknown
}> {}
