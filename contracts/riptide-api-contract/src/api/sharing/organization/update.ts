import { taskOrganizationAclSelectSchema } from '@humanlayer/db/tables/task-organization-acl'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const UpdateOrgSharingInputSchema = z.object({
	taskId: z.uuidv7(),
	permissionLevel: z.enum(['read', 'edit']).nullable(), // 'read' or 'edit' = share, null = unshare
})

export const UpdateOrgSharingOutputSchema = z.object({
	transactionId: z.string(),
	acl: taskOrganizationAclSelectSchema.nullable(), // null when unshared
})

export const updateOrgSharingContract = contractBuilder
	.input(UpdateOrgSharingInputSchema)
	.output(UpdateOrgSharingOutputSchema)
