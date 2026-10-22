import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { buildConversationEventsSyncWhere } from '../../../../db/sync-auth'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

/**
 * List conversation events for a session with optional role filter and pagination.
 *
 * Authorization: ACL-based row filtering via buildConversationEventsSyncWhere — same rules
 * as the conversation events sync endpoint (org scope + ownership/user ACL/org ACL).
 * The required sessionId further scopes results to a single session.
 */
export const listSessionEventsProcedure = effectOrpcBaseOrganizationRequired.sessions.events.list.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { sessionId, role: filterRole, limit, offset } = input
	const { organizationId, userId } = context.auth

	const rows = yield* Effect.gen(function* () {
		const authWhere = yield* Effect.try({
			try: () => buildConversationEventsSyncWhere({ organizationId, userId }, postgres.client),
			catch: () => errors.INTERNAL_SERVER_ERROR({}),
		})

		const additionalFilters = [eq(conversationEvents.session_id, sessionId)]
		if (filterRole) additionalFilters.push(eq(conversationEvents.role, filterRole))

		return yield* postgres.query(
			postgres.client
				.select()
				.from(conversationEvents)
				.where(and(authWhere, ...additionalFilters))
				.orderBy(asc(conversationEvents.created_at))
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
