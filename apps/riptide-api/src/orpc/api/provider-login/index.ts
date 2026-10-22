import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { type ProviderLoginRequest, providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../effects/services/postgres/helpers'
import { PostgresDb, type PostgresTransaction } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

const PROVIDER_LOGIN_TTL_MS = 10 * 60 * 1000

type ProviderLoginRequestView = RiptideApiOutputs['providerLogin']['list']['requests'][number]

export function toProviderLoginRequestView(row: ProviderLoginRequest): ProviderLoginRequestView {
	return {
		id: row.id,
		hostId: row.host_id,
		provider: row.provider,
		method: row.method,
		status: row.status,
		url: row.url,
		userCode: row.user_code,
		submittedCode: row.submitted_code,
		error: row.error,
		accountLabel: row.account_label,
		expiresAt: Number(row.expires_at),
		createdAt: Number(row.created_at),
		updatedAt: Number(row.updated_at),
	}
}

const ownedRequest = (tx: PostgresTransaction, requestId: string, userId: string, organizationId: string) =>
	tx
		.query(
			tx.client
				.select()
				.from(providerLoginRequests)
				.where(
					and(
						eq(providerLoginRequests.id, requestId),
						eq(providerLoginRequests.user_id, userId),
						eq(providerLoginRequests.organization_id, organizationId),
					),
				)
				.limit(1),
		)
		.pipe(Effect.map(([row]) => row ?? null))

export const createProviderLoginProcedure = effectOrpcBaseOrganizationRequired.providerLogin.create.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [ownedHost] = yield* tx.query(
					tx.client
						.select({ hostId: onlineHosts.host_id })
						.from(onlineHosts)
						.where(
							and(
								eq(onlineHosts.host_id, input.hostId),
								eq(onlineHosts.user_id, userId),
								eq(onlineHosts.organization_id, organizationId),
							),
						)
						.limit(1),
				)
				if (!ownedHost) return yield* Effect.fail(errors.NOT_FOUND())
				const now = BigInt(yield* Clock.currentTimeMillis)
				yield* tx.query(
					tx.client
						.update(providerLoginRequests)
						.set({ status: 'cancelled' })
						.where(
							and(
								eq(providerLoginRequests.organization_id, organizationId),
								eq(providerLoginRequests.user_id, userId),
								eq(providerLoginRequests.host_id, input.hostId),
								eq(providerLoginRequests.provider, input.provider),
								inArray(providerLoginRequests.status, ['requested', 'awaiting_approval']),
							),
						),
				)
				const [row] = yield* tx.query(
					tx.client
						.insert(providerLoginRequests)
						.values({
							organization_id: organizationId,
							user_id: userId,
							host_id: input.hostId,
							provider: input.provider,
							method: input.method ?? 'device',
							expires_at: now + BigInt(PROVIDER_LOGIN_TTL_MS),
						})
						.returning({ id: providerLoginRequests.id }),
				)
				if (!row) return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
				const transactionId = yield* getTransactionId(tx)
				return { requestId: row.id, transactionId }
			}),
		)
		.pipe(
			Effect.tapError((error) => Effect.logError(error)),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
})

export const submitProviderLoginCodeProcedure = effectOrpcBaseOrganizationRequired.providerLogin.submitCode.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth
		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const row = yield* ownedRequest(tx, input.requestId, userId, organizationId)
					if (!row) return yield* Effect.fail(errors.NOT_FOUND())
					if (row.status !== 'awaiting_approval') {
						return yield* Effect.fail(
							errors.BAD_REQUEST({ data: { message: 'This sign-in is no longer waiting for a code' } }),
						)
					}
					yield* tx.query(
						tx.client
							.update(providerLoginRequests)
							.set({ submitted_code: input.code, error: null })
							.where(eq(providerLoginRequests.id, row.id)),
					)
					const transactionId = yield* getTransactionId(tx)
					return { transactionId }
				}),
			)
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	},
)

export const cancelProviderLoginProcedure = effectOrpcBaseOrganizationRequired.providerLogin.cancel.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const row = yield* ownedRequest(tx, input.requestId, userId, organizationId)
				if (!row) return yield* Effect.fail(errors.NOT_FOUND())
				if (row.status === 'requested' || row.status === 'awaiting_approval') {
					yield* tx.query(
						tx.client
							.update(providerLoginRequests)
							.set({ status: 'cancelled', submitted_code: null })
							.where(eq(providerLoginRequests.id, row.id)),
					)
				}
				const transactionId = yield* getTransactionId(tx)
				return { transactionId }
			}),
		)
		.pipe(
			Effect.tapError((error) => Effect.logError(error)),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
})

export const listProviderLoginsProcedure = effectOrpcBaseOrganizationRequired.providerLogin.list.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth
	const scope = [eq(providerLoginRequests.organization_id, organizationId), eq(providerLoginRequests.user_id, userId)]
	if (input.hostId) scope.push(eq(providerLoginRequests.host_id, input.hostId))
	const rows = yield* postgres
		.query(
			postgres.client
				.select()
				.from(providerLoginRequests)
				.where(and(...scope))
				.orderBy(desc(providerLoginRequests.created_at))
				.limit(50),
		)
		.pipe(
			Effect.tapError((error) => Effect.logError(error)),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
	return { requests: rows.map(toProviderLoginRequestView) }
})
