import type { WorkspaceState, WorkspaceStateRepo } from '@humanlayer/schemas/effect/workspace/workspace-state'
import z from 'zod/v4'

export const WorkspaceStateRepoSchema = z.object({
	path: z.string(),
	description: z.string().optional(),
	remoteUrl: z.string().optional(),
	sourceRef: z.string(),
	sourceCommit: z.string().optional(),
	branch: z.string(),
	branchRemote: z.string().min(1).optional(),
	primary: z.boolean(),
})

export const WorkspaceStateSchema = z.object({
	workspaceBaseDirectory: z.string(),
	repos: z.array(WorkspaceStateRepoSchema),
})

export type { WorkspaceState, WorkspaceStateRepo }
