import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const EnsureStreamHydratedInputSchema = z.object({
	sessionId: z.uuidv7(),
})

export const EnsureStreamHydratedOutputSchema = z.object({
	sessionId: z.uuidv7(),
	status: z.enum(['created', 'hydrated', 'exists']),
	eventCount: z.number().int().nonnegative().optional(),
})

export const ensureStreamHydratedContract = contractBuilder
	.input(EnsureStreamHydratedInputSchema)
	.output(EnsureStreamHydratedOutputSchema)
