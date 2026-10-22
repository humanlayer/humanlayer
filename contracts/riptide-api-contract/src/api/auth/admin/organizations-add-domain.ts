import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const AddDomainInputSchema = z.object({ domain: z.string() })
export const AddDomainOutputSchema = z.object({ success: z.boolean() })

export const addDomainContract = contractBuilder
	.input(AddDomainInputSchema)
	.output(AddDomainOutputSchema)
	.errors({
		DOMAIN_LIMIT_EXCEEDED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		DOMAIN_ALREADY_EXISTS: {
			status: StatusCodes.CONFLICT,
			data: z.object({ message: z.string() }),
		},
		INVALID_DOMAIN: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
