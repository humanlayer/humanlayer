import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResyncSeatsInputSchema = z.object({})

export const ResyncSeatsOutputSchema = z.object({
	seatCount: z.number().int().positive(),
	subscriptionId: z.string().min(1),
	subscriptionItemId: z.string().min(1),
	stripeQuantityChanged: z.boolean(),
})

export const resyncSeatsContract = contractBuilder.input(ResyncSeatsInputSchema).output(ResyncSeatsOutputSchema)
