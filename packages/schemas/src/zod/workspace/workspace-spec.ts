import type {
	WorkspaceSourceCommit,
	WorkspaceSpec,
	WorkspaceSpecRepo,
} from '@humanlayer/schemas/effect/workspace/workspace-spec'
import z from 'zod/v4'

export const WorkspaceSourceCommitSchema = z.string().regex(/^[0-9a-f]{40}$/i)

export const WorkspaceSpecRepoSchema = z.object({
	localPath: z.string().min(1),
	targetPath: z.string().min(1),
	branch: z.string().min(1),
	sourceRef: z.string().min(1),
	branchRemote: z.string().min(1).optional(),
	sourceCommit: WorkspaceSourceCommitSchema.optional(),
	setupCommand: z.string().optional(),
	copyGlobs: z.array(z.string()).default([]),
	primary: z.boolean(),
})

export const WorkspaceSpecSchema = z
	.object({
		specVersion: z.number().int().positive().default(1),
		directory: z.string().min(1),
		workspaceBaseDirectory: z.string().min(1),
		setupBlocksFirstSession: z.boolean().default(false),
		repos: z.array(WorkspaceSpecRepoSchema).min(1),
	})
	.refine((spec) => spec.repos.filter((repo) => repo.primary).length === 1, {
		message: 'workspace spec must contain exactly one primary repo',
		path: ['repos'],
	})

export type { WorkspaceSourceCommit, WorkspaceSpec, WorkspaceSpecRepo }
