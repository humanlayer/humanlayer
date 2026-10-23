import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const RemoveDomainInputSchema = z.object({ domain: z.string() })
export const RemoveDomainOutputSchema = z.object({ success: z.boolean() })

export const removeDomainContract = contractBuilder
	.input(RemoveDomainInputSchema)
	.output(RemoveDomainOutputSchema)
	.errors({
		DOMAIN_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
	})
