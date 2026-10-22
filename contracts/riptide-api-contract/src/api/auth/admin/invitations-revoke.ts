import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const RevokeAdminInvitationInputSchema = z.object({
	invitationId: z.string(),
})

export const RevokeAdminInvitationOutputSchema = z.object({
	success: z.boolean(),
})

export const revokeAdminInvitationContract = contractBuilder
	.input(RevokeAdminInvitationInputSchema)
	.output(RevokeAdminInvitationOutputSchema)
	.errors({
		INVITATION_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
	})
