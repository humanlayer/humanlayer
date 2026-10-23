import type {
	ProjectRepositories,
	ProjectRepository,
	ProjectRepositoryPaths,
} from '@humanlayer/schemas/effect/project-workspace/project-recipe'
import { hasRepositoryUrlCredentials } from '@humanlayer/schemas/effect/project-workspace/project-recipe'
import z from 'zod/v4'

export const NormalizedRepositoryIdentitySchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9.-]+\/[a-zA-Z0-9._~/-]+$/)

export const RepositoryRemoteUrlSchema = z
	.string()
	.min(1)
	.refine((value) => !hasRepositoryUrlCredentials(value), 'Repository URLs must not contain embedded credentials')

export const ProjectRepositorySchema = z.object({
	remoteUrl: RepositoryRemoteUrlSchema,
	repositoryIdentity: NormalizedRepositoryIdentitySchema,
	defaultBranch: z.string().min(1),
	default: z.boolean(),
	description: z.string().min(1).optional(),
	autoPushBranch: z.boolean(),
	copyGlobs: z.array(z.string()),
	setupCommand: z.string().optional(),
})

export const ProjectRepositoriesSchema = z
	.array(ProjectRepositorySchema)
	.min(1)
	.refine(
		(repositories) =>
			new Set(repositories.map((repository) => repository.repositoryIdentity)).size === repositories.length,
		'project repositories must have unique repository identities',
	)
	.refine(
		(repositories) => repositories.filter((repository) => repository.default).length === 1,
		'project repositories must contain exactly one default repository',
	)

export const ProjectRepositoryPathsSchema = z.record(NormalizedRepositoryIdentitySchema, z.string().min(1))

export type { ProjectRepositories, ProjectRepository, ProjectRepositoryPaths }
