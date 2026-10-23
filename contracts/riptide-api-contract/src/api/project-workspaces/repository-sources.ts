import {
	RepositorySourcePreferenceSchema,
	RepositorySourceSelectionsSchema,
	WorkspaceRepositoriesSchema,
	WorkspaceRepositoryActorSnapshotSchema,
} from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

const taskRepositorySourcesInputSchema = z.object({
	taskId: z.uuid(),
	hostId: z.string().min(1),
})

const taskRepositorySourcesOutputSchema = taskRepositorySourcesInputSchema.extend({
	projectId: z.uuid(),
	workspaceId: z.uuid(),
	placementExists: z.boolean(),
	/** Where a new session runs on this host; null until the task is set up here. */
	sessionDirectory: z.string().nullable(),
	repositories: WorkspaceRepositoriesSchema,
	sources: RepositorySourceSelectionsSchema,
})

const repositorySourcesErrors = {
	NOT_FOUND: { status: StatusCodes.NOT_FOUND, data: z.object({ message: z.string() }) },
	HOST_NOT_AUTHORIZED: { status: StatusCodes.FORBIDDEN, data: z.object({ message: z.string() }) },
	REPOSITORY_SOURCES_INVALID: { status: StatusCodes.BAD_REQUEST, data: z.object({ message: z.string() }) },
} as const

export const getProjectWorkspaceRepositorySourcesContract = contractBuilder
	.input(taskRepositorySourcesInputSchema)
	.output(taskRepositorySourcesOutputSchema)
	.errors(repositorySourcesErrors)

export const upsertProjectWorkspaceRepositorySourcesContract = contractBuilder
	.input(taskRepositorySourcesInputSchema.extend({ sources: RepositorySourceSelectionsSchema }))
	.output(taskRepositorySourcesOutputSchema)
	.errors(repositorySourcesErrors)

export const recoverProjectWorkspaceRepositorySourceContract = contractBuilder
	.input(
		taskRepositorySourcesInputSchema.extend({
			repositoryIdentity: z.string().min(1),
			expectedUpdatedAt: z.number().int().nonnegative(),
			source: RepositorySourcePreferenceSchema,
		}),
	)
	.output(
		z.object({
			repository: WorkspaceRepositoryActorSnapshotSchema,
		}),
	)
	.errors({
		NOT_FOUND: repositorySourcesErrors.NOT_FOUND,
		RECOVERY_NOT_ALLOWED: { status: StatusCodes.CONFLICT, data: z.object({ message: z.string() }) },
		STATUS_CHANGED: { status: StatusCodes.CONFLICT, data: z.object({ message: z.string() }) },
	})
