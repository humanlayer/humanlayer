import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const discoverWorkspaceAgentCommandsContract = contractBuilder
	.input(
		z.object({
			hostId: z.string().min(1),
			agent: z.string().default('claude'),
			workspacePath: z.string().trim().min(1),
		}),
	)
	.output(z.object({ requested: z.boolean() }))
