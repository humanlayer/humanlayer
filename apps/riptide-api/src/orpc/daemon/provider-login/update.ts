import { type ProviderLoginStatus, providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcDaemonBase } from '../../effect-base'

type ProviderLoginRequestPatch = Partial<typeof providerLoginRequests.$inferInsert>

const TERMINAL_STATUSES: ReadonlySet<ProviderLoginStatus> = new Set(['succeeded', 'failed', 'cancelled'])

export const updateDaemonProviderLoginProcedure = effectOrpcDaemonBase.providerLogin.update.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { organizationId, hostId } = context.auth
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [row] = yield* tx.query(
					tx.client
						.select({ id: providerLoginRequests.id, status: providerLoginRequests.status })
						.from(providerLoginRequests)
						.where(
							and(
								eq(providerLoginRequests.id, input.requestId),
								eq(providerLoginRequests.organization_id, organizationId),
								eq(providerLoginRequests.host_id, hostId),
							),
						)
						.limit(1),
				)
				if (!row) return yield* Effect.fail(errors.NOT_FOUND())
				const patch: ProviderLoginRequestPatch = {}
				if (TERMINAL_STATUSES.has(row.status)) {
					const transactionId = yield* getTransactionId(tx)
					return { transactionId }
				}
				if (input.status !== undefined) patch.status = input.status
				if (input.url !== undefined) patch.url = input.url
				if (input.userCode !== undefined) patch.user_code = input.userCode
				if (input.error !== undefined) patch.error = input.error
				if (input.accountLabel !== undefined) patch.account_label = input.accountLabel
				if (input.clearSubmittedCode) patch.submitted_code = null
				if (Object.keys(patch).length > 0) {
					yield* tx.query(
						tx.client.update(providerLoginRequests).set(patch).where(eq(providerLoginRequests.id, row.id)),
					)
				}
				const transactionId = yield* getTransactionId(tx)
				return { transactionId }
			}),
		)
		.pipe(
			Effect.tapError((error) => Effect.logError(error)),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
})
