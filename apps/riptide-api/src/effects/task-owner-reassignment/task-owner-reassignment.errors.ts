import { Data } from 'effect'

export class TaskOwnerTaskNotFoundError extends Data.TaggedError('TaskOwnerTaskNotFoundError')<{
	readonly taskId: string
	readonly organizationId: string
}> {}

export class TaskOwnerReassignmentForbiddenError extends Data.TaggedError('TaskOwnerReassignmentForbiddenError')<{
	readonly taskId: string
	readonly actingUserId: string
	readonly organizationId: string
}> {}

export class TaskOwnerRecipientIneligibleError extends Data.TaggedError('TaskOwnerRecipientIneligibleError')<{
	readonly taskId: string
	readonly newOwnerUserId: string
	readonly organizationId: string
}> {}

export class TaskOwnerRecipientUnchangedError extends Data.TaggedError('TaskOwnerRecipientUnchangedError')<{
	readonly taskId: string
	readonly ownerUserId: string
	readonly organizationId: string
}> {}

export class TaskOwnerWorkosFailureError extends Data.TaggedError('TaskOwnerWorkosFailureError')<{
	readonly taskId: string
	readonly newOwnerUserId: string
	readonly organizationId: string
	readonly cause: unknown
}> {}

export class TaskOwnerDatabaseFailureError extends Data.TaggedError('TaskOwnerDatabaseFailureError')<{
	readonly taskId: string
	readonly newOwnerUserId: string
	readonly organizationId: string
	readonly retryable: boolean
	readonly cause: unknown
}> {}

export type TaskOwnerReassignmentError =
	| TaskOwnerTaskNotFoundError
	| TaskOwnerReassignmentForbiddenError
	| TaskOwnerRecipientIneligibleError
	| TaskOwnerRecipientUnchangedError
	| TaskOwnerWorkosFailureError
	| TaskOwnerDatabaseFailureError
