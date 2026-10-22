import {
	NormalizedRepositoryIdentitySchema,
	WorkspaceRepositoryActorSnapshotSchema,
	WorkspaceRepositorySetupResultSchema,
} from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ReportWorkspaceRepositoryResultInputSchema = z.object({
	projectId: z.uuid(),
	workspaceId: z.uuid(),
	repositoryIdentity: NormalizedRepositoryIdentitySchema,
	generation: z.number().int().positive(),
	expectedUpdatedAt: z.number().int().nonnegative(),
	result: WorkspaceRepositorySetupResultSchema,
})

export type ReportWorkspaceRepositoryResultInput = z.output<typeof ReportWorkspaceRepositoryResultInputSchema>

export const ReportWorkspaceRepositoryResultOutputSchema = z.object({
	snapshot: WorkspaceRepositoryActorSnapshotSchema,
})

export const reportWorkspaceRepositoryResultContract = contractBuilder
	.input(ReportWorkspaceRepositoryResultInputSchema)
	.output(ReportWorkspaceRepositoryResultOutputSchema)
	.errors({
		REPOSITORY_STATUS_CHANGED: {
			status: StatusCodes.CONFLICT,
			data: z.object({ snapshot: WorkspaceRepositoryActorSnapshotSchema }),
		},
	})
