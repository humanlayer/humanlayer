import { Effect } from 'effect'

import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../../effect-base'

/**
 * Accepts and discards what a daemon's post-run `gh pr view` scan reports. The server discovers
 * pull requests itself, from the branch events a session reports and through the GitHub App,
 * and a daemon that still scans must not fail its post-run step over a route that is gone.
 */
export const upsertSessionPullRequestProcedure = effectOrpcDaemonBase.sessions.pullRequests.upsert
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context }) {
		yield* Effect.logDebug('Ignored daemon pull request report').pipe(
			Effect.annotateLogs({
				organizationId: context.auth.organizationId,
				hostId: context.auth.hostId,
				sessionId: input.sessionId,
				repoFullName: input.repoFullName.toLowerCase(),
				number: input.number,
			}),
		)
		return { pullRequestId: null }
	})
