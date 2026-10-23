import { RepositorySourceSelectionsSchema } from '@humanlayer/schemas/zod/project-workspace'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

const repositorySourcesInputSchema = z.object({
	projectId: z.uuid(),
	hostId: z.string().min(1),
})

const repositorySourcesOutputSchema = repositorySourcesInputSchema.extend({
	sources: RepositorySourceSelectionsSchema,
})

const repositorySourcesErrors = {
	PROJECT_NOT_FOUND: { status: StatusCodes.NOT_FOUND, data: z.object({ projectId: z.string() }) },
	HOST_NOT_AUTHORIZED: { status: StatusCodes.FORBIDDEN, data: z.object({ message: z.string() }) },
	REPOSITORY_SOURCES_INVALID: { status: StatusCodes.BAD_REQUEST, data: z.object({ message: z.string() }) },
} as const

export const getProjectV2RepositorySourcesContract = contractBuilder
	.input(repositorySourcesInputSchema)
	.output(repositorySourcesOutputSchema)
	.errors(repositorySourcesErrors)

export const upsertProjectV2RepositorySourcesContract = contractBuilder
	.input(repositorySourcesInputSchema.extend({ sources: RepositorySourceSelectionsSchema }))
	.output(repositorySourcesOutputSchema)
	.errors(repositorySourcesErrors)
