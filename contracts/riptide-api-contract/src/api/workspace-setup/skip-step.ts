import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const skipWorkspaceSetupStepContract = contractBuilder
	.input(
		z.object({
			taskId: z.uuid(),
			hostId: z.string().min(1),
			localPath: z.string().min(1),
			stage: z.enum(['copy_globs', 'setup_command']),
		}),
	)
	.output(z.object({ transactionId: z.string() }))
