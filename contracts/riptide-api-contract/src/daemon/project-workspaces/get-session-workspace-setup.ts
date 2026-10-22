import { SessionStatusSchema } from '@humanlayer/schemas/zod/session/session-status'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetSessionWorkspaceSetupInputSchema = z.object({
	sessionId: z.uuid(),
	workspaceId: z.uuid(),
})

export const SessionWorkspaceSetupSchema = z.object({
	workspaceId: z.uuid(),
	/**
	 * Authoritative session status at read time. The launch actor uses it to mark a session
	 * waiting only once and to stop without a handoff once another path has taken the session.
	 */
	sessionStatus: SessionStatusSchema,
	defaultWorkingDirectory: z.string().min(1),
	ready: z.boolean(),
	repositories: z.array(
		z.object({
			repositoryIdentity: z.string().min(1),
			status: z.string(),
			default: z.boolean(),
			worktreePath: z.string().nullable(),
		}),
	),
})

export const GetSessionWorkspaceSetupOutputSchema = SessionWorkspaceSetupSchema

export const getSessionWorkspaceSetupContract = contractBuilder
	.input(GetSessionWorkspaceSetupInputSchema)
	.output(GetSessionWorkspaceSetupOutputSchema)
