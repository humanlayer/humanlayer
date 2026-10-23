import { sessions } from '@humanlayer/db/tables/sessions'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { buildSessionsSyncWhere } from '../../../db/sync-auth'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

/**
 * List sessions with optional task/user filters and pagination.
 *
 * Authorization: ACL-based row filtering via buildSessionsSyncWhere — same rules
 * as the sessions sync endpoint (org scope + ownership/user ACL/org ACL).
 */
export const listSessionsEffectProcedure = effectOrpcBaseOrganizationRequired.sessions.list.effect(function* ({
	input,
	context,
	errors,
}) {
	// services
	const postgres = yield* PostgresDb

	// impl
	const { taskId: filterTaskId, userId: filterUserId, limit, offset } = input
	const { organizationId, userId } = context.auth

	const authWhere = buildSessionsSyncWhere({ organizationId, userId }, postgres.client)

	const additionalFilters = []
	if (filterTaskId) additionalFilters.push(eq(sessions.task_id, filterTaskId))
	if (filterUserId) additionalFilters.push(eq(sessions.resource_owner_user_id, filterUserId))

	const rows = yield* postgres
		.query(
			postgres.client
				.select()
				.from(sessions)
				.where(additionalFilters.length > 0 ? and(authWhere, ...additionalFilters) : authWhere)
				.orderBy(desc(sessions.created_at))
				.limit(limit)
				.offset(offset),
		)
		.pipe(
			Effect.tap((result) =>
				Effect.logInfo('Listed sessions').pipe(
					Effect.annotateLogs({
						count: result.length,
						organizationId,
						userId,
						filterTaskId,
						filterUserId,
					}),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	return { rows }
})
