import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const EmailCapabilitySchema = z.discriminatedUnion('configured', [
	z.object({
		configured: z.literal(true),
		/** The sender address on invites and notifications. Not secret. */
		fromAddress: z.string(),
	}),
	z.object({ configured: z.literal(false) }),
])

export const GetIntegrationCapabilitiesInputSchema = z.object({}).optional()

/**
 * What this deployment supports. Each flag is true when the server has every key the integration
 * needs. The values are fixed at startup, so clients can fetch once and keep the answer for the
 * session.
 */
export const GetIntegrationCapabilitiesOutputSchema = z.object({
	slack: z.boolean(),
	github: z.boolean(),
	jira: z.boolean(),
	linear: z.boolean(),
	/** True when Stripe is set up. Billing enforcement is a separate, build-time flag. */
	billing: z.boolean(),
	email: EmailCapabilitySchema,
})

export type IntegrationCapabilities = z.infer<typeof GetIntegrationCapabilitiesOutputSchema>
export type EmailCapability = z.infer<typeof EmailCapabilitySchema>

export const getIntegrationCapabilitiesContract = contractBuilder
	.input(GetIntegrationCapabilitiesInputSchema)
	.output(GetIntegrationCapabilitiesOutputSchema)
