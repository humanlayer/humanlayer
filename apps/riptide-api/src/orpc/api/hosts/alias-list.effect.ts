import { hostAliases } from '@humanlayer/db/tables/host-aliases'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const listHostAliasesEffectProcedure = effectOrpcBaseOrganizationRequired.hosts.alias.list.effect(function* ({
	context,
	errors,
}) {
	// services
	const postgres = yield* PostgresDb

	// impl
	const { userId, organizationId } = context.auth

	const aliases = yield* postgres
		.query(
			postgres.client
				.select({
					hostId: hostAliases.host_id,
					displayName: hostAliases.display_name,
				})
				.from(hostAliases)
				.where(and(eq(hostAliases.user_id, userId), eq(hostAliases.organization_id, organizationId))),
		)
		.pipe(
			Effect.mapError((error) =>
				error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR(),
			),
		)

	return { aliases }
})
