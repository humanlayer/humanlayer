import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { and, count, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../../effect-base'

export const adminCountUnreadAccessRequestsEffectProcedure =
	effectOrpcBaseForOrganizationAdmin.auth.admin.accessRequests.unreadCount.effect(function* ({ context, errors }) {
		// services
		const postgres = yield* PostgresDb

		// impl
		const { organizationId } = context.auth

		const result = yield* postgres
			.query(
				postgres.client
					.select({ count: count() })
					.from(accessRequests)
					.where(
						and(eq(accessRequests.organization_id, organizationId), eq(accessRequests.status, 'pending')),
					),
			)
			.pipe(
				Effect.map(([row]) => ({ count: Number(row?.count ?? 0) })),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		yield* Effect.logInfo('Admin unread access requests counted').pipe(
			Effect.annotateLogs({ organizationId, count: result.count }),
		)

		return result
	})
