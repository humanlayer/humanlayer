import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const CreateAccessRequestInputSchema = z.object({
	artifactId: z.uuid(),
	email: z.email().optional(),
})

export const CreateAccessRequestOutputSchema = z.object({
	accessRequestId: z.uuid(),
	// True when the requester already had a pending WorkOS invitation, so admins
	// were not re-notified — the UI prompts the requester to check their email.
	alreadyInvited: z.boolean(),
})

export const createAccessRequestContract = contractBuilder
	.input(CreateAccessRequestInputSchema)
	.output(CreateAccessRequestOutputSchema)
	.errors({
		ALREADY_REQUESTED_ACCESS: {
			status: StatusCodes.TOO_MANY_REQUESTS,
			data: z.object({
				message: z.string(),
				retryAfter: z.iso.datetime(),
				existingRequestStatus: z.enum(['pending', 'invited', 'archived']),
			}),
		},
		FEATURE_DISABLED: {
			status: StatusCodes.FORBIDDEN,
			data: z.object({ message: z.string() }),
		},
	})
