import { stripeCustomerIdSchema as StripeCustomerIdSchema } from '@humanlayer/db/tables/organizations'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const CreateOrganizationInputSchema = z.object({
	name: z.string().min(1, 'Organization name is required').max(100),
	domains: z.array(z.string()).default([]),
	inviteEmails: z.array(z.email()).default([]),
	eulaAccepted: z.literal(true, {
		error: 'You must accept the EULA to create an organization',
	}),
})

export const CreateOrganizationOutputSchema = z.object({
	organizationId: z.string(),
	workosOrganizationId: z.string(),
	organizationName: z.string(),
	stripeCustomerId: StripeCustomerIdSchema.optional(),
	failedInvites: z.array(z.string()).default([]),
})

export const createOrganizationContract = contractBuilder
	.input(CreateOrganizationInputSchema)
	.output(CreateOrganizationOutputSchema)
