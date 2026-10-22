import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const exchangeDaemonTokenContract = contractBuilder
	.input(
		z.object({
			launchToken: z.string(),
			hostId: z.string().uuid(),
		}),
	)
	.output(
		z.object({
			token: z.string(),
		}),
	)
