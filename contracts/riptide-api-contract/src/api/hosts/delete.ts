import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const HOST_DELETE_AFTER_MS = 15 * 60 * 1000

export const deleteHostInputSchema = z.object({ hostId: z.string() })
export const deleteHostOutputSchema = z.object({ hostId: z.string() })

export const deleteHostContract = contractBuilder.input(deleteHostInputSchema).output(deleteHostOutputSchema)
