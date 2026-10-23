import { PermissionUpdateSchema } from '@humanlayer/db/zodschemas/permission-update'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResolveApprovalInputSchema = z.object({
	approvalId: z.uuid(),
	decision: z.enum(['approve', 'deny']),
	comment: z.string().optional(),
	appliedSuggestions: z.array(PermissionUpdateSchema).optional(),
})

export const ResolveApprovalOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const resolveApprovalContract = contractBuilder
	.input(ResolveApprovalInputSchema)
	.output(ResolveApprovalOutputSchema)
