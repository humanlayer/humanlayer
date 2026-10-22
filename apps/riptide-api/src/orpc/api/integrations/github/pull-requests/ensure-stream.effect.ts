import { type PrStatusKey, prStatusStreamPath } from '@humanlayer/streams/pr-status'
import { Effect } from 'effect'

import { GitHubService } from '../../../../../effects/services/github/github.service'
import { toCheckRows, toPullRequestRow } from '../../../../../effects/services/github/pull-requests/github-api'
import { recordPullRequest } from '../../../../../effects/services/github/pull-requests/persistence'
import { PrStatusStream } from '../../../../../effects/services/pr-status-stream/pr-status-stream.service'
import { effectOrpcBaseOrganizationRequired } from '../../../../effect-base'
import { captureQueryFailure } from './capture-query-failure'
import { resolvePullRequestTarget } from './resolve-target'

export const ensurePullRequestStreamProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.pullRequests.ensureStream.effect(function* ({
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

		const key: PrStatusKey = {
			organizationId,
			repoFullName: target.repoFullName,
			branch: target.branch,
		}
		const streamPath = prStatusStreamPath(key)
		const base = { streamPath, repoFullName: target.repoFullName, branch: target.branch }

		const fetched = yield* github
			.fetchPullRequest({ organizationId, repoFullName: target.repoFullName, branch: target.branch })
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubRepositoryNotAccessibleError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubRepositoryAccessBlockedError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_repository_access_blocked' } })),
					GitHubMissingPermissionsError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_checks_permission_required' } })),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		const pullRequest = fetched
			? toPullRequestRow({ repoFullName: target.repoFullName, branch: target.branch, ...fetched })
			: null

		// The row outlives the stream. A failed write is logged where it happens and must not cost
		// the reader the live panel.
		if (pullRequest) {
			yield* recordPullRequest({
				organizationId,
				repoFullName: target.repoFullName,
				row: pullRequest,
				source: 'app',
				owner: {
					taskId: target.taskId,
					sessionId: target.sessionId,
					resourceOwnerUserId: target.resourceOwnerUserId,
				},
			}).pipe(Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.void))
		}

		yield* stream.hydrate(key, { pullRequest, checks: fetched ? toCheckRows(fetched.wire) : [] }).pipe(
			Effect.catchTags({
				PrStatusStreamInitializationError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PrStatusStreamAppendError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)

		return { ...base, hasPullRequest: pullRequest !== null }
	})
