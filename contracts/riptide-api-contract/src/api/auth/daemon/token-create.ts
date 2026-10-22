import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const createDaemonTokenProcedureContract = contractBuilder
	.input(
		z.object({
			hostId: z.string().uuid(),
		}),
	)
	.output(
		z.object({
			token: z.string(),
		}),
	)
