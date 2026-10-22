import { Effect } from 'effect'

import { effectOrpcBaseOrganizationRequired } from '../../../../effect-base'
import { captureQueryFailure } from './capture-query-failure'
import { listPullRequestBranches } from './list-branches'

export const listPullRequestBranchesProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.pullRequests.listPullRequestBranches.effect(function* ({
		input,
		context,
		errors,
	}) {
		const organizationId = context.auth.organizationId

		const branches = yield* listPullRequestBranches({
			organizationId,
			userId: context.auth.userId,
			scope: input,
		}).pipe(
			Effect.catchTags({
				PullRequestTargetUnresolvedError: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.reason } })),
				PostgresDbQueryError: (cause) =>
					captureQueryFailure(
						'list_pull_request_branches',
						organizationId,
					)(cause).pipe(Effect.andThen(Effect.fail(errors.SERVICE_UNAVAILABLE()))),
				GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

		return { branches }
	})
