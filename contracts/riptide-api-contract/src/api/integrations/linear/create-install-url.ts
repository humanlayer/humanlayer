import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { RiptideClientSchema } from '../../../types/client'

/**
 * Mints a one-time, hashed, expiring OAuth state row and returns Linear's consent URL.
 * There is no `redirectUri` — the API owns it, so the browser cannot choose where
 * Linear sends the code. `client` decides which button the result screen leads with.
 */
export const CreateLinearInstallUrlInputSchema = z.object({
	client: RiptideClientSchema.default('cloud'),
})
export const CreateLinearInstallUrlOutputSchema = z.object({
	url: z.string(),
	expiresAt: z.number(),
})
export const createLinearInstallUrlContract = contractBuilder
	.input(CreateLinearInstallUrlInputSchema)
	.output(CreateLinearInstallUrlOutputSchema)
