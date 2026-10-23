import { type PrStatusKey } from '@humanlayer/streams/pr-status'
import { Effect } from 'effect'

import { GitHubService } from '../../../../../effects/services/github/github.service'
import { toPullRequestRow } from '../../../../../effects/services/github/pull-requests/github-api'
import { recordPullRequest } from '../../../../../effects/services/github/pull-requests/persistence'
import { PrStatusStream } from '../../../../../effects/services/pr-status-stream/pr-status-stream.service'
import { effectOrpcBaseOrganizationRequired } from '../../../../effect-base'
import { captureQueryFailure } from './capture-query-failure'
import { resolvePullRequestTarget } from './resolve-target'

export const GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED = 'github_pull_requests_write_permission_required'

/**
 * One write to the pull request as the App, then GitHub's answer recorded and put on the stream,
 * so every panel on the branch converges on the result before the webhook for it lands. The row
 * comes back too, for the caller that pressed the button. The branch is resolved through the
 * caller's scope first, exactly as the panel's own read is, because the App's grant is wider than
 * any one member's.
 */
export const mutatePullRequestProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.pullRequests.mutate.effect(function* ({
		input,
		context,
		errors,
	}) {
		const github = yield* GitHubService
		const stream = yield* PrStatusStream
		const organizationId = context.auth.organizationId

		const target = yield* resolvePullRequestTarget({
			organizationId,
			userId: context.auth.userId,
			scope: input,
		}).pipe(
			Effect.catchTags({
				PullRequestTargetUnresolvedError: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.reason } })),
				PostgresDbQueryError: (cause) =>
					captureQueryFailure(
						'resolve_pull_request_target',
						organizationId,
					)(cause).pipe(Effect.andThen(Effect.fail(errors.SERVICE_UNAVAILABLE()))),
				GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

		const fetched = yield* github
			.mutatePullRequest({
				organizationId,
				repoFullName: target.repoFullName,
				branch: target.branch,
				number: input.number,
				mutation: input.mutation,
			})
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubRepositoryNotAccessibleError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubPullRequestNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubRepositoryAccessBlockedError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_repository_access_blocked' } })),
					// A write-level grant missing is the App unable to write; only read-level grants missing is
					// the panel's stale-grant state, which can also follow a write that landed and could not
					// be read back.
					GitHubMissingPermissionsError: (error) =>
						Effect.fail(
							errors.BAD_REQUEST({
								data: {
									message: error.missing.some((detail) => detail.requiredLevel === 'write')
										? GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED
										: 'github_checks_permission_required',
								},
							}),
						),
					GitHubPullRequestMutationRejectedError: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		if (fetched === null) return yield* Effect.fail(errors.NOT_FOUND())
		const { wire, repository } = fetched

		const recorded = yield* recordPullRequest({
			organizationId,
			repoFullName: target.repoFullName,
			row: toPullRequestRow({ repoFullName: target.repoFullName, branch: target.branch, wire, repository }),
			source: 'app',
			owner: {
				taskId: target.taskId,
				sessionId: target.sessionId,
				resourceOwnerUserId: target.resourceOwnerUserId,
			},
		}).pipe(Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())))
		const pullRequest = recorded.panelRow

		const key: PrStatusKey = { organizationId, repoFullName: target.repoFullName, branch: target.branch }
		// The write already happened; a stream nobody is watching is not a reason to report failure.
		yield* stream
			.publishPullRequest(key, pullRequest)
			.pipe(Effect.catchTag('PrStatusStreamAppendError', () => Effect.void))

		return { pullRequest }
	})
