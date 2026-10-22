import {
	WorkspaceLocationSchema,
	WorkspaceRepositoryActorSnapshotSchema,
	WorkspaceSnapshotSchema,
} from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetProjectWorkspaceStatusInputSchema = z.object({
	taskId: z.uuid(),
})

export const GetProjectWorkspaceStatusOutputSchema = z.object({
	workspace: WorkspaceSnapshotSchema,
	materializations: z.array(
		z.object({
			userId: z.string().min(1),
			hostId: z.string().min(1),
			hostName: z.string().nullable(),
			location: WorkspaceLocationSchema,
			repositories: z.array(WorkspaceRepositoryActorSnapshotSchema),
		}),
	),
})

export const getProjectWorkspaceStatusContract = contractBuilder
	.input(GetProjectWorkspaceStatusInputSchema)
	.output(GetProjectWorkspaceStatusOutputSchema)
	.errors({ NOT_FOUND: { status: StatusCodes.NOT_FOUND, data: z.object({ message: z.string() }) } })
