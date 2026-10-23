import type { AclPermissionLevel } from '@humanlayer/db/tables/task-user-acl'
import { Data } from 'effect'

export class TaskNotFoundError extends Data.TaggedError('TaskNotFoundError')<{
	taskId: string
	organizationId: string
}> {}

export class TaskPermissionDeniedError extends Data.TaggedError('TaskPermissionDeniedError')<{
	taskId: string
	userId: string
	organizationId: string
	required: 'read' | 'edit'
	actual: AclPermissionLevel | null
}> {}
