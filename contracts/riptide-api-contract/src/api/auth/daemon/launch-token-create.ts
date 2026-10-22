import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const createLaunchTokenContract = contractBuilder.input(z.object({})).output(
	z.object({
		token: z.string(),
		expiresAt: z.string(),
	}),
)
