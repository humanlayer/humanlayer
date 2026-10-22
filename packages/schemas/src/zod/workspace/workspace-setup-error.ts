import type {
	WorkspaceSetupError,
	WorkspaceSetupStage,
} from '@humanlayer/schemas/effect/workspace/workspace-setup-error'
import z from 'zod/v4'

export const WorkspaceSetupStageSchema = z.enum([
	'setup_requested',
	'preflight',
	'worktree',
	'copy_globs',
	'setup_command',
	'done',
])

export const WorkspaceSetupErrorSchema = z.object({
	localPath: z.string().min(1),
	stage: WorkspaceSetupStageSchema,
	message: z.string().min(1),
	command: z.string().optional(),
	exitCode: z.number().int().optional(),
	stderr: z.string().optional(),
})

export type { WorkspaceSetupError, WorkspaceSetupStage }
