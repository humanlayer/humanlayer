import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

/**
 * One call carries the FULL snapshot of the repositories the daemon currently
 * sees for a session. `repoFullName` is absent by design: the server parses it
 * from `remoteUrl`, so a daemon cannot claim a repository it is not in.
 */
export const ReportSessionRepositoriesInputSchema = z.object({
	sessionId: z.uuid(),
	repositories: z
		.array(
			z.object({
				/** Absolute repository root on the host (`git rev-parse --show-toplevel`). */
				localPath: z.string().min(1),
				/** `origin` url; absent when the repository has no remote. */
				remoteUrl: z.string().optional(),
				/** Branch HEAD points at; absent when HEAD is detached. */
				branch: z.string().min(1).optional(),
			}),
		)
		.max(50),
})

export const ReportSessionRepositoriesOutputSchema = z.object({
	recorded: z.number().int(),
})

export const reportSessionRepositoriesContract = contractBuilder
	.input(ReportSessionRepositoriesInputSchema)
	.output(ReportSessionRepositoriesOutputSchema)
