import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const updateWorkspaceSetupRepositoryDirectoryContract = contractBuilder
	.input(
		z.object({
			taskId: z.uuid(),
			hostId: z.string().min(1),
			repositoryDirectory: z.string().trim().min(1),
			expectedUpdatedAt: z.string().regex(/^\d+$/),
		}),
	)
	.output(z.object({ transactionId: z.string() }))
