import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ListUserInvitationsInputSchema = z
	.object({
		state: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional().default('pending'),
	})
	.optional()

export const ListUserInvitationsOutputSchema = z.object({
	invitations: z.array(
		z.object({
			id: z.string(),
			token: z.string(),
			acceptInvitationUrl: z.string().url(),
			organizationId: z.string().nullable(),
			organization: z
				.object({
					name: z.string(),
					domains: z.array(z.hostname()),
				})
				.nullable(),
		}),
	),
})

export const listUserInvitationsContract = contractBuilder
	.input(ListUserInvitationsInputSchema)
	.output(ListUserInvitationsOutputSchema)
