import { Effect } from 'effect'

import { AccessRequestService } from '../../../../../effects/services/access-request/access-request.service'
import { Sentry } from '../../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../../effect-base'

export const adminArchiveAccessRequestProcedure =
	effectOrpcBaseForOrganizationAdmin.auth.admin.accessRequests.archive.effect(function* ({ context, input, errors }) {
		const accessRequests = yield* AccessRequestService
		const { organizationId, userId } = context.auth
		yield* Effect.annotateCurrentSpan({
			access_request_id: input.requestId,
			organization_id: organizationId,
			archived_by_user_id: userId,
		})

		yield* accessRequests
			.archiveRequest({
				accessRequestId: input.requestId,
				organizationId,
				archivedByUserId: userId,
			})
			.pipe(
				Effect.withSpan('access_requests.archive_request', {
					attributes: {
						access_request_id: input.requestId,
						organization_id: organizationId,
						archived_by_user_id: userId,
					},
				}),
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTag('AccessRequestUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())),
			)

		yield* Effect.logInfo('Access request archived').pipe(
			Effect.annotateLogs({
				accessRequestId: input.requestId,
				organizationId,
				archivedByUserId: userId,
			}),
		)

		return { ok: true as const }
	})
