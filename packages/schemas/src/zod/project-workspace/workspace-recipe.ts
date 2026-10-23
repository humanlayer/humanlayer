import type {
	GitCommitSha,
	WorkspaceRepositories,
	WorkspaceRepository,
} from '@humanlayer/schemas/effect/project-workspace/workspace-recipe'
import z from 'zod/v4'

import { NormalizedRepositoryIdentitySchema, RepositoryRemoteUrlSchema } from './project-recipe'

export const GitCommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i)

export const WorkspaceRepositorySchema = z.object({
	remoteUrl: RepositoryRemoteUrlSchema,
	repositoryIdentity: NormalizedRepositoryIdentitySchema,
	defaultBranch: z.string().min(1),
	branch: z.string().min(1),
	baseCommit: GitCommitShaSchema.optional(),
	default: z.boolean(),
	description: z.string().min(1).optional(),
	autoPushBranch: z.boolean(),
	copyGlobs: z.array(z.string()),
	setupCommand: z.string().optional(),
})

export const WorkspaceRepositoriesSchema = z
	.array(WorkspaceRepositorySchema)
	.min(1)
	.refine(
		(repositories) =>
			new Set(repositories.map((repository) => repository.repositoryIdentity)).size === repositories.length,
		'workspace repositories must have unique repository identities',
	)
	.refine(
		(repositories) => repositories.filter((repository) => repository.default).length === 1,
		'workspace repositories must contain exactly one default repository',
	)

export type { GitCommitSha, WorkspaceRepositories, WorkspaceRepository }
