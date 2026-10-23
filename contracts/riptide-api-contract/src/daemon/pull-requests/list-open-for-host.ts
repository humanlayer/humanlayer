import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

/**
 * @deprecated The server refreshes open pull requests itself through the GitHub App. Kept so a
 * daemon that still sweeps gets an empty list, not a missing route.
 */
export const ListOpenPullRequestsForHostInputSchema = z.object({
	limit: z.number().int().positive().max(50).default(50),
	/** Only return rows not confirmed within this window (default 6h). */
	staleThresholdMs: z
		.number()
		.int()
		.positive()
		.default(6 * 60 * 60 * 1000),
})

/** Always empty. */
export const ListOpenPullRequestsForHostOutputSchema = z.object({
	pullRequests: z.array(
		z.object({
			id: z.uuid(),
			repoFullName: z.string(),
			number: z.number().int(),
			/** epoch ms; null when never confirmed with GitHub. */
			lastCheckedAt: z.number().int().nullable(),
		}),
	),
})

export const listOpenPullRequestsForHostContract = contractBuilder
	.input(ListOpenPullRequestsForHostInputSchema)
	.output(ListOpenPullRequestsForHostOutputSchema)
