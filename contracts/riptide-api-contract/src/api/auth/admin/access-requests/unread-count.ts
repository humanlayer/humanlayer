import z from 'zod/v4'

import { contractBuilder } from '../../../../contract-builder'

export const UnreadCountInputSchema = z.object({})

export const UnreadCountOutputSchema = z.object({ count: z.number().int().nonnegative() })

export const unreadCountContract = contractBuilder.input(UnreadCountInputSchema).output(UnreadCountOutputSchema)
