import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../../effect-base'

export const syncGitHubArtifactBacklinkProcedure = effectOrpcDaemonBase.integrations.github.syncArtifactBacklink
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context }) {
		const github = yield* GitHubService
		return yield* github
			.syncArtifactBacklink({
				organizationId: context.auth.organizationId,
				userId: context.auth.userId,
				taskId: input.taskId,
			})
			.pipe(
				Effect.as({ synced: true }),
				Effect.catchCause((cause) =>
					Effect.logWarning('GitHub artifact backlink notification did not sync').pipe(
						Effect.annotateLogs({ task_id: input.taskId, cause }),
						Effect.as({ synced: false }),
					),
				),
			)
	})
