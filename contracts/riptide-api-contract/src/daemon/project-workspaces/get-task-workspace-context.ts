import { TaskWorkspaceContextSchema } from '@humanlayer/schemas/zod/project-workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

/**
 * Task-scoped repository context for the calling daemon. The API derives user and host from the
 * daemon token, so a daemon only ever sees its own placement of the task's workspace.
 */
export const GetTaskWorkspaceContextInputSchema = z.object({
	taskId: z.uuid(),
})

export const GetTaskWorkspaceContextOutputSchema = TaskWorkspaceContextSchema

export const getTaskWorkspaceContextContract = contractBuilder
	.input(GetTaskWorkspaceContextInputSchema)
	.output(GetTaskWorkspaceContextOutputSchema)
