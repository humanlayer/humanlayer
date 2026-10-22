import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const AcceptUserInvitationInputSchema = z.object({
	invitationToken: z.string(),
})

export const AcceptUserInvitationOutputSchema = z.object({
	organizationId: z.string(),
})

export const acceptUserInvitationContract = contractBuilder
	.input(AcceptUserInvitationInputSchema)
	.output(AcceptUserInvitationOutputSchema)
	.errors({
		INVITATION_EXPIRED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({
				message: z.string(),
			}),
		},
		INVITATION_REVOKED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({
				message: z.string(),
			}),
		},
		INVITATION_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({
				message: z.string(),
			}),
		},
		INVITATION_ALREADY_ACCEPTED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({
				message: z.string(),
			}),
		},
	})
