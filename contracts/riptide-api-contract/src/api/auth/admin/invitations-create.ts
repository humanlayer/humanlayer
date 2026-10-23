import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const CreateAdminInvitationInputSchema = z.object({
	email: z.string().email(),
	roleSlug: z.enum(['admin', 'member']).default('member'),
	expiresInDays: z.number().int().min(1).max(30).default(7),
})

export const CreateAdminInvitationOutputSchema = z.object({
	invitation: z.object({
		id: z.string(),
		email: z.string(),
		state: z.string(),
	}),
})

export const createAdminInvitationContract = contractBuilder
	.input(CreateAdminInvitationInputSchema)
	.output(CreateAdminInvitationOutputSchema)
	.errors({
		ALREADY_A_MEMBER: {
			status: StatusCodes.CONFLICT,
			data: z.object({ message: z.string() }),
		},
		ALREADY_INVITED: {
			status: StatusCodes.CONFLICT,
			data: z.object({ message: z.string() }),
		},
	})
