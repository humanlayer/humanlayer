import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const refreshTokenContract = contractBuilder
	.input(
		z.object({
			refreshToken: z.string(),
			organizationId: z.string().optional(),
		}),
	)
	.output(
		z.object({
			accessToken: z.string(),
			refreshToken: z.string(),
		}),
	)
