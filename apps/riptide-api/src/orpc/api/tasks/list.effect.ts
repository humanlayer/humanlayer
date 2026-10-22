import { tasks } from '@humanlayer/db/tables/tasks'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { buildTasksSyncWhere } from '../../../db/sync-auth'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

/**
 * List tasks with optional user filter and pagination.
 *
 * Authorization: ACL-based row filtering via buildTasksSyncWhere — same rules
 * as the tasks sync endpoint (org scope + ownership/user ACL/org ACL).
 */
export const listTasksProcedure = effectOrpcBaseOrganizationRequired.tasks.list.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId: filterUserId, limit, offset } = input
	const { organizationId, userId } = context.auth

	const rows = yield* Effect.gen(function* () {
		const authWhere = yield* Effect.try({
			try: () => buildTasksSyncWhere({ organizationId, userId }, postgres.client),
			catch: () => errors.INTERNAL_SERVER_ERROR({}),
		})

		return yield* postgres.query(
			postgres.client
				.select()
				.from(tasks)
				.where(filterUserId ? and(authWhere, eq(tasks.resource_owner_user_id, filterUserId)) : authWhere)
				.orderBy(desc(tasks.created_at))
				.limit(limit)
				.offset(offset),
		)
	}).pipe(
		Effect.tapError((e) => Effect.logError(e)),
		Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
		Effect.catchTags({
			PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
		}),
	)

	return { rows }
})
