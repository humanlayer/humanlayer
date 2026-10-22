import { taskUserAclSelectSchema } from '@humanlayer/db/tables/task-user-acl'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const UpdateUserSharingInputSchema = z.object({
	taskId: z.uuidv7(),
	subjectUserId: z.string(),
	permissionLevel: z.enum(['read', 'edit']).nullable(),
})

export const UpdateUserSharingOutputSchema = z.object({
	transactionId: z.string(),
	acl: taskUserAclSelectSchema.nullable(),
})

export const updateUserSharingContract = contractBuilder
	.input(UpdateUserSharingInputSchema)
	.output(UpdateUserSharingOutputSchema)
