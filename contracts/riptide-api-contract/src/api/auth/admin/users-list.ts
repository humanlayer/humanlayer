import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { MembershipStatusSchema } from '../../../types/billing'

export const ListAdminUsersInputSchema = z.object({})

export const ListAdminUsersOutputSchema = z.object({
	users: z.array(
		z.object({
			id: z.string(),
			email: z.string(),
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			profilePictureUrl: z.string().optional(),
			role: z.string(),
			membershipId: z.string(),
			status: MembershipStatusSchema,
			createdAt: z.string(),
			// Per-user Advanced Metrics opt-in (see users-set-metrics-advanced).
			metricsAdvancedEnabled: z.boolean(),
		}),
	),
})

export const listAdminUsersContract = contractBuilder
	.input(ListAdminUsersInputSchema)
	.output(ListAdminUsersOutputSchema)
