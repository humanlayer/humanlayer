import { ProviderLoginStatusSchema } from '@humanlayer/db/tables/provider-login-requests'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const updateDaemonProviderLoginContract = contractBuilder
	.input(
		z.object({
			requestId: z.uuid(),
			status: ProviderLoginStatusSchema.optional(),
			url: z.string().optional(),
			userCode: z.string().optional(),
			error: z.string().nullable().optional(),
			accountLabel: z.string().optional(),
			clearSubmittedCode: z.boolean().optional(),
		}),
	)
	.output(z.object({ transactionId: z.string() }))
