import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

/**
 * The one answer every GitHub surface branches on.
 * `not_connected`: no installation exists, so the surfaces ask for one.
 * `connected`: an active installation exists, so they show pull requests.
 * `disabled`: an installation exists and an admin switched the integration off in settings.
 */
export const GitHubStatusSchema = z.enum(['not_connected', 'connected', 'disabled'])
export type GitHubStatus = z.infer<typeof GitHubStatusSchema>

export const GetGitHubStatusOutputSchema = z.object({
	status: GitHubStatusSchema,
	/** Only an organization admin can install the App; the others get a request to pass on. */
	isAdmin: z.boolean(),
})
export type GetGitHubStatusOutput = z.infer<typeof GetGitHubStatusOutputSchema>

export const getGitHubStatusContract = contractBuilder
	.input(z.object({}).optional())
	.output(GetGitHubStatusOutputSchema)
