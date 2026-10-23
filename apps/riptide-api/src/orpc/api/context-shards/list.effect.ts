import { type ContextShard, contextShards } from '@humanlayer/db/tables/context-shards'
import { type UserShardState, userShardPreferences } from '@humanlayer/db/tables/user-shard-preferences'
import type { UserContextShardRow } from '@humanlayer/riptide-api-contract/api/context-shards/list'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

/**
 * List released, non-admin-dismissed shards for the authenticated user's
 * organization, joined with the current user's sparse preference.
 *
 * A missing preference row resolves to the effective state `disabled`.
 * Active rows come first by created_at DESC then id DESC; user-dismissed rows
 * always sort last in the same order.
 */
export const listContextShardsProcedure = effectOrpcBaseOrganizationRequired.contextShards.list.effect(function* ({
	context,
	errors,
}) {
	// services
	const postgres = yield* PostgresDb

	// impl
	const { organizationId, userId } = context.auth

	const data = yield* postgres
		.query(
			postgres.client
				.select({ shard: contextShards, preferenceState: userShardPreferences.shard_state })
				.from(contextShards)
				.leftJoin(
					userShardPreferences,
					and(
						eq(userShardPreferences.shard_id, contextShards.id),
						eq(userShardPreferences.organization_id, contextShards.organization_id),
						eq(userShardPreferences.user_id, userId),
					),
				)
				.where(
					and(
						eq(contextShards.organization_id, organizationId),
						eq(contextShards.released_to_org, true),
						eq(contextShards.dismissed, false),
					),
				)
				.orderBy(desc(contextShards.created_at), desc(contextShards.id)),
		)
		.pipe(
			Effect.map((rows) => {
				const mapped: UserContextShardRow[] = (
					rows as Array<{ shard: ContextShard; preferenceState: UserShardState | null }>
				).map(({ shard, preferenceState }) => ({
					id: shard.id,
					shardText: shard.shard_text,
					evidence: shard.evidence_json,
					state: preferenceState ?? 'disabled',
					createdAt: Number(shard.created_at),
				}))

				// Active rows first; user-dismissed rows always last, same relative order.
				const active = mapped.filter((row) => row.state !== 'dismissed')
				const dismissed = mapped.filter((row) => row.state === 'dismissed')

				return [...active, ...dismissed]
			}),
			Effect.tap((rows) =>
				Effect.logInfo('Listed context shards').pipe(
					Effect.annotateLogs({ organizationId, userId, count: rows.length }),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	return { data }
})
