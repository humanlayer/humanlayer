import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { Effect } from 'effect'

import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

export const upsertHostAliasEffectProcedure = effectOrpcBaseOrganizationRequired.hosts.alias.upsert
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		// services
		const postgres = yield* PostgresDb

		// logic
		const { userId, organizationId } = context.auth

		yield* postgres
			.query(
				postgres.client
					.insert(hostAliases)
					.values({
						host_id: input.hostId,
						user_id: userId,
						organization_id: organizationId,
						display_name: input.displayName,
					})
					.onConflictDoUpdate({
						target: [hostAliases.host_id, hostAliases.user_id, hostAliases.organization_id],
						set: { display_name: input.displayName },
					}),
			)
			.pipe(
				// if the error indicates retryable (e.g. PG conn issue) return service unavailable (temporarily) vs. internal server
				Effect.mapError((error) =>
					error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR(),
				),
			)

		return { hostId: input.hostId, displayName: input.displayName }
	})
