import { approvals } from '@humanlayer/db/tables/approvals'
import { and, getTableColumns } from 'drizzle-orm'
import { Effect } from 'effect'

import { buildApprovalsSyncWhere } from '../../../db/sync-auth'
import { buildDrizzleOrderFromSorts, buildDrizzleWhereFromExpression, SyncFilterError } from '../../../db/sync-filters'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const syncApprovalsEffectProcedure = effectOrpcBaseOrganizationRequired.sync.approvals.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { organizationId, userId } = context.auth
	const { where, sorts, limit, offset } = input

	const rows = yield* Effect.gen(function* () {
		const authWhere = yield* Effect.try({
			try: () => buildApprovalsSyncWhere({ organizationId, userId }, postgres.client),
			catch: () => errors.INTERNAL_SERVER_ERROR({}),
		})

		const clientWhere = yield* Effect.try({
			try: () => buildDrizzleWhereFromExpression(getTableColumns(approvals), where, 'approvals'),
			catch: (error) => {
				if (error instanceof SyncFilterError) {
					return errors.BAD_REQUEST({ data: { message: error.message } })
				}
				return errors.INTERNAL_SERVER_ERROR({})
			},
		})

		const orderBy = yield* Effect.try({
			try: () => buildDrizzleOrderFromSorts(getTableColumns(approvals), sorts, 'approvals'),
			catch: (error) => {
				if (error instanceof SyncFilterError) {
					return errors.BAD_REQUEST({ data: { message: error.message } })
				}
				return errors.INTERNAL_SERVER_ERROR({})
			},
		})

		let query = postgres.client.select().from(approvals).where(and(authWhere, clientWhere)).$dynamic()

		if (orderBy.length > 0) query = query.orderBy(...orderBy)
		query = query.limit(limit ?? 10000)
		if (offset !== undefined) query = query.offset(offset)

		return yield* postgres.query(query)
	}).pipe(
		Effect.tap((result) =>
			Effect.logInfo('Sync approvals query completed').pipe(
				Effect.annotateLogs({
					organizationId,
					userId,
					rowCount: result.length,
					hasWhere: !!where,
					hasSorts: !!sorts?.length,
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
