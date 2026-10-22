import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

export const requestHostUpdateEffectProcedure = effectOrpcBaseOrganizationRequired.hosts.update.request
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		// services
		const postgres = yield* PostgresDb

		// logic
		const { userId, organizationId } = context.auth
		const ownedHost = and(
			eq(onlineHosts.host_id, input.hostId),
			eq(onlineHosts.organization_id, organizationId),
			eq(onlineHosts.user_id, userId),
		)
		const failOnUnavailableDatabase = Effect.mapError((error: { retryable: boolean }) =>
			error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR(),
		)

		const [host] = yield* postgres
			.query(
				postgres.client
					.select({
						canSelfUpdate: onlineHosts.can_self_update,
						distribution: onlineHosts.distribution,
					})
					.from(onlineHosts)
					.where(ownedHost),
			)
			.pipe(failOnUnavailableDatabase)

		if (host === undefined) {
			return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Could not find that host' } }))
		}

		if (host.canSelfUpdate !== true || host.distribution !== 'cli') {
			return yield* Effect.fail(errors.BAD_REQUEST({ data: { message: 'This daemon cannot update itself' } }))
		}

		yield* postgres
			.query(
				postgres.client
					.update(onlineHosts)
					.set({
						update_requested_version: input.version,
						update_state: 'requested',
						update_error: null,
					})
					.where(ownedHost),
			)
			.pipe(failOnUnavailableDatabase)

		return { hostId: input.hostId, version: input.version }
	})
