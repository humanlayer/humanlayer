import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { HOST_DELETE_AFTER_MS } from '@humanlayer/riptide-api-contract/api/hosts/delete'
import { and, eq } from 'drizzle-orm'
import { Clock, Data, Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

export interface DeleteHostRegistrationInput {
	readonly hostId: string
	readonly organizationId: string
	readonly userId: string
}

export class HostRegistrationNotFound extends Data.TaggedError('HostRegistrationNotFound')<{}> {}
export class HostRegistrationNotEligible extends Data.TaggedError('HostRegistrationNotEligible')<{}> {}

export const deleteHostRegistration = Effect.fn('hosts.delete')(function* (input: DeleteHostRegistrationInput) {
	const postgres = yield* PostgresDb
	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const identity = and(
					eq(onlineHosts.host_id, input.hostId),
					eq(onlineHosts.organization_id, input.organizationId),
					eq(onlineHosts.user_id, input.userId),
				)
				const [host] = yield* tx.query(
					tx.client
						.select({ status: onlineHosts.status, lastSeen: onlineHosts.last_seen })
						.from(onlineHosts)
						.where(identity)
						.for('update'),
				)
				if (host === undefined) return yield* Effect.fail(new HostRegistrationNotFound())
				// Read time after acquiring the lock: a competing heartbeat may have refreshed the row.
				const now = BigInt(yield* Clock.currentTimeMillis)
				if (host.status !== 'offline' || host.lastSeen > now - BigInt(HOST_DELETE_AFTER_MS)) {
					return yield* Effect.fail(new HostRegistrationNotEligible())
				}
				yield* tx.query(tx.client.delete(onlineHosts).where(identity))
				yield* tx.query(
					tx.client
						.delete(hostAliases)
						.where(
							and(
								eq(hostAliases.host_id, input.hostId),
								eq(hostAliases.organization_id, input.organizationId),
								eq(hostAliases.user_id, input.userId),
							),
						),
				)
				yield* tx.query(
					tx.client
						.delete(agentSlashCommands)
						.where(
							and(
								eq(agentSlashCommands.host_id, input.hostId),
								eq(agentSlashCommands.organization_id, input.organizationId),
								eq(agentSlashCommands.user_id, input.userId),
							),
						),
				)
				return { hostId: input.hostId }
			}),
		)
		.pipe(
			Effect.catchTags({
				PostgresDbQueryError: (error) =>
					Effect.logError('Host deletion query failed', error).pipe(
						Effect.annotateLogs({ ...input }),
						Effect.andThen(Effect.sync(() => Sentry.captureException(error, { extra: { ...input } }))),
						Effect.andThen(Effect.fail(error)),
					),
				PostgresDbTransactionError: (error) =>
					Effect.logError('Host deletion transaction failed', error).pipe(
						Effect.annotateLogs({ ...input }),
						Effect.andThen(Effect.sync(() => Sentry.captureException(error, { extra: { ...input } }))),
						Effect.andThen(Effect.fail(error)),
					),
			}),
		)
})

export const deleteHostEffectProcedure = effectOrpcBaseOrganizationRequired.hosts.delete
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		return yield* deleteHostRegistration({
			hostId: input.hostId,
			organizationId: context.auth.organizationId,
			userId: context.auth.userId,
		}).pipe(
			Effect.catchTags({
				HostRegistrationNotFound: () => Effect.fail(errors.NOT_FOUND()),
				HostRegistrationNotEligible: () => Effect.fail(errors.BAD_REQUEST({ data: {} })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
	})
