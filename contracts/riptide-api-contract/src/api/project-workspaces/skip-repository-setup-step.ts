import { WorkspaceRepositoryActorSnapshotSchema } from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const SkipProjectWorkspaceRepositorySetupStepInputSchema = z.object({
	taskId: z.uuid(),
	hostId: z.string().min(1),
	repositoryIdentity: z.string().min(1),
	expectedUpdatedAt: z.number().int().nonnegative(),
})

export const skipProjectWorkspaceRepositorySetupStepContract = contractBuilder
	.input(SkipProjectWorkspaceRepositorySetupStepInputSchema)
	.output(z.object({ repository: WorkspaceRepositoryActorSnapshotSchema }))
	.errors({
		NOT_FOUND: { status: StatusCodes.NOT_FOUND, data: z.object({ message: z.string() }) },
		SKIP_NOT_ALLOWED: { status: StatusCodes.BAD_REQUEST, data: z.object({ message: z.string() }) },
		STATUS_CHANGED: {
			status: StatusCodes.CONFLICT,
			data: z.object({ repository: WorkspaceRepositoryActorSnapshotSchema }),
		},
	})
