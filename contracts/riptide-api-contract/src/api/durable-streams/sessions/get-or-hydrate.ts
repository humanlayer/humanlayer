import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetOrHydrateDurableStreamSessionsInputSchema = z.object({
	sessionIds: z.array(z.string().uuid()).min(1).max(100),
})

export const GetOrHydrateDurableStreamSessionsOutputSchema = z.object({
	streams: z.array(
		z.object({
			sessionId: z.string().uuid(),
			status: z.enum(['created', 'hydrated', 'exists']),
			eventCount: z.number().int().nonnegative().optional(),
		}),
	),
})

export const getOrHydrateDurableStreamSessionsContract = contractBuilder
	.input(GetOrHydrateDurableStreamSessionsInputSchema)
	.output(GetOrHydrateDurableStreamSessionsOutputSchema)
