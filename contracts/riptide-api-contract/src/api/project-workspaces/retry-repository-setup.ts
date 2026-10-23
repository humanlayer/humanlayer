import { WorkspaceRepositoryActorSnapshotSchema } from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const RetryProjectWorkspaceRepositorySetupInputSchema = z.object({
	taskId: z.uuid(),
	hostId: z.string().min(1),
	repositoryIdentity: z.string().min(1),
	expectedUpdatedAt: z.number().int().nonnegative(),
})

export const retryProjectWorkspaceRepositorySetupContract = contractBuilder
	.input(RetryProjectWorkspaceRepositorySetupInputSchema)
	.output(z.object({ repository: WorkspaceRepositoryActorSnapshotSchema }))
	.errors({
		NOT_FOUND: { status: StatusCodes.NOT_FOUND, data: z.object({ message: z.string() }) },
		NOTHING_TO_RETRY: {
			status: StatusCodes.CONFLICT,
			data: z.object({ repository: WorkspaceRepositoryActorSnapshotSchema }),
		},
		STATUS_CHANGED: {
			status: StatusCodes.CONFLICT,
			data: z.object({ repository: WorkspaceRepositoryActorSnapshotSchema }),
		},
	})
