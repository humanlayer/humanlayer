import {
	WorkspaceRepositoryActorSnapshotSchema,
	WorkspaceRepositoryStatusIdentitySchema,
} from '@humanlayer/schemas/zod/project-workspace'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetWorkspaceRepositoryStatusInputSchema = WorkspaceRepositoryStatusIdentitySchema

export const GetWorkspaceRepositoryStatusOutputSchema = z.object({
	repositoryStatus: WorkspaceRepositoryActorSnapshotSchema,
})

export const getWorkspaceRepositoryStatusContract = contractBuilder
	.input(GetWorkspaceRepositoryStatusInputSchema)
	.output(GetWorkspaceRepositoryStatusOutputSchema)
