import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ListAdminInvitationsInputSchema = z.object({})

export const ListAdminInvitationsOutputSchema = z.object({
	invitations: z.array(
		z.object({
			id: z.string(),
			email: z.string(),
			state: z.string(),
			roleSlug: z.string().optional(),
			createdAt: z.string(),
			expiresAt: z.string().optional(),
			acceptedAt: z.string().optional(),
		}),
	),
})

export const listAdminInvitationsContract = contractBuilder
	.input(ListAdminInvitationsInputSchema)
	.output(ListAdminInvitationsOutputSchema)
