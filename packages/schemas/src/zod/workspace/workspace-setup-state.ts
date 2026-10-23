import type {
	AcceptedWorkspaceSetupSkip,
	RepoWorkspaceSetupProgress,
	WorkspaceSetupState,
} from '@humanlayer/schemas/effect/workspace/workspace-setup-state'
import z from 'zod/v4'

import { WorkspaceSetupStageSchema } from './workspace-setup-error'

export const AcceptedWorkspaceSetupSkipSchema = z.object({
	localPath: z.string().min(1),
	stage: z.enum(['copy_globs', 'setup_command']),
	skippedByUserId: z.string().min(1),
	skippedAt: z.number().int().nonnegative(),
	command: z.string().optional(),
	errorMessage: z.string().optional(),
})

export const RepoWorkspaceSetupProgressSchema = z.object({
	localPath: z.string().min(1),
	status: WorkspaceSetupStageSchema,
	preflight: z
		.object({ resolvedSourceCommit: z.string().optional(), branchRemote: z.string().min(1).optional() })
		.optional(),
	worktree: z
		.object({
			targetPath: z.string().optional(),
			remoteName: z.string().min(1).optional(),
			remoteUrl: z.string().optional(),
			upstreamRef: z.string().min(1).optional(),
			published: z.boolean().optional(),
		})
		.optional(),
	copyGlobs: z.object({ filesCopied: z.array(z.string()).optional() }).optional(),
	setupCommand: z.object({ command: z.string(), exitCode: z.number().int().optional() }).optional(),
})

export const WorkspaceSetupStateSchema = z.object({
	specVersion: z.number().int().positive(),
	startedAt: z.number().int().nonnegative().optional(),
	finishedAt: z.number().int().nonnegative().optional(),
	repos: z.array(RepoWorkspaceSetupProgressSchema),
	acceptedSkips: z.array(AcceptedWorkspaceSetupSkipSchema).optional(),
})

export type { AcceptedWorkspaceSetupSkip, RepoWorkspaceSetupProgress, WorkspaceSetupState }
