import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { PullRequestStateSchema } from './pull-request-state'

/**
 * @deprecated The server owns pull request state through the GitHub App. Kept so a daemon that
 * still sweeps gets an accepted no-op, not a missing route.
 */
export const RefreshPullRequestStatusInputSchema = z
	.object({
		updates: z
			.array(
				z.object({
					pullRequestId: z.uuid(),
					state: PullRequestStateSchema,
					isDraft: z.boolean(),
					mergedAt: z.number().int().optional(), // epoch ms
					mergedByGithubLogin: z.string().optional(),
					closedAt: z.number().int().optional(),
					title: z.string().optional(),
				}),
			)
			.max(50)
			.default([]),
		/**
		 * PRs the sweep checked but could not produce a status for (fetch failed,
		 * unmappable state — e.g. the repo was deleted or made inaccessible). The
		 * server bumps ONLY their last_checked_at, so the stale-first ordering can
		 * never be starved by permanently-unfetchable rows re-sorting to the front
		 * of every sweep.
		 */
		failedPullRequestIds: z.array(z.uuid()).max(50).default([]),
	})
	.refine((input) => input.updates.length > 0 || input.failedPullRequestIds.length > 0, {
		message: 'report at least one update or failed id',
	})

/** Both counts are always zero. */
export const RefreshPullRequestStatusOutputSchema = z.object({
	updated: z.number().int(),
	failedMarked: z.number().int(),
})

export const refreshPullRequestStatusContract = contractBuilder
	.input(RefreshPullRequestStatusInputSchema)
	.output(RefreshPullRequestStatusOutputSchema)
