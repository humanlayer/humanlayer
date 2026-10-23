import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/**
 * Accepts and discards a daemon's refresh sweep. The server owns pull request state through the
 * GitHub App; a daemon that still sweeps gets an empty result rather than a route that is gone.
 */
export const refreshPullRequestStatusProcedure = effectOrpcDaemonBase.pullRequests.refreshStatus
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* () {
		return { updated: 0, failedMarked: 0 }
	})
