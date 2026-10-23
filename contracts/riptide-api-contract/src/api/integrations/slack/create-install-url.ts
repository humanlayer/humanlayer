import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const createSlackInstallUrlContract = contractBuilder
	.input(z.object({}).optional())
	.output(z.object({ url: z.string(), expiresAt: z.number() }))
