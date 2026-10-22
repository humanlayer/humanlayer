import { WorkspaceSetupStageSchema } from '@humanlayer/schemas/zod/workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const retryWorkspaceSetupStepContract = contractBuilder
	.input(
		z.object({
			taskId: z.uuid(),
			hostId: z.string().min(1),
			localPath: z.string().min(1),
			stage: WorkspaceSetupStageSchema,
		}),
	)
	.output(z.object({ transactionId: z.string() }))
