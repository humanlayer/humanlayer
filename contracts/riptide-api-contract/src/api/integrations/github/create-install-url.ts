import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const createGitHubInstallUrlContract = contractBuilder
	.input(z.object({ connectionId: z.uuid().optional() }).optional())
	.output(z.object({ url: z.url(), expiresAt: z.number() }))
