import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const CreateApprovalInputSchema = z.object({
	sessionId: z.uuid(),
	toolName: z.string(),
	toolInput: z.any(),
	toolUseId: z.string().optional(),
	agentId: z.string().optional(),
	suggestions: z.any().optional(),
})

export const CreateApprovalOutputSchema = z.object({
	approvalId: z.uuid(),
	transactionId: z.string(),
})

export const createApprovalContract = contractBuilder
	.input(CreateApprovalInputSchema)
	.output(CreateApprovalOutputSchema)
