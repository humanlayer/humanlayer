import { repositoryLocationsForUserForHost } from '@humanlayer/db/tables/repository-locations-for-user-for-host'
import type {
	ProjectRepositoryPaths,
	RepositorySourcePreference,
	RepositorySourceSelections,
	WorkspaceLocation,
	WorkspaceRepositoryStatusIdentity,
} from '@humanlayer/schemas/effect/project-workspace'
import * as Sentry from '@sentry/node'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Clock, Effect, Match } from 'effect'

import type { PostgresDbQueryError } from '../services/postgres/postgres-db.errors'
import { PostgresDb, type PostgresTransaction } from '../services/postgres/postgres-db.service'

function captureLocationQueryFailure<A, R>(effect: Effect.Effect<A, PostgresDbQueryError, R>) {
	return effect.pipe(Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))))
}

export type RepositoryLocationScope = Pick<WorkspaceLocation, 'organizationId' | 'userId' | 'hostId'>

export type ConfiguredRepositorySourcePreference = (
	| (Extract<RepositorySourcePreference, { kind: 'filesystem' }> & {
			readonly sourceKind: 'filesystem'
			readonly sourcePath: string
	  })
	| (Extract<RepositorySourcePreference, { kind: 'managed_clone' }> & {
			readonly sourceKind: 'managed_clone'
			readonly sourcePath: null
	  })
) &
	Pick<WorkspaceRepositoryStatusIdentity, 'repositoryIdentity'> &
	Pick<WorkspaceLocation, 'createdAt' | 'updatedAt'>

export const readRepositoryLocationsWithExecutor = Effect.fn(
	'project_workspace.read_repository_locations_with_executor',
)(function* (
	db: PostgresTransaction,
	input: RepositoryLocationScope & { readonly repositoryIdentities: readonly string[] },
) {
	if (input.repositoryIdentities.length === 0) return []
	const locations = repositoryLocationsForUserForHost
	const rows = yield* db
		.query(
			db.client
				.select()
				.from(locations)
				.where(
					and(
						eq(locations.organization_id, input.organizationId),
						eq(locations.user_id, input.userId),
						eq(locations.host_id, input.hostId),
						inArray(locations.repository_identity, [...input.repositoryIdentities]),
					),
				)
				.orderBy(asc(locations.repository_identity)),
		)
		.pipe(captureLocationQueryFailure)
	return rows.map((row): ConfiguredRepositorySourcePreference => {
		const timestamps = { createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
		return row.source_kind === 'filesystem'
			? {
					repositoryIdentity: row.repository_identity,
					kind: 'filesystem',
					path: row.source_path ?? '',
					sourceKind: 'filesystem',
					sourcePath: row.source_path ?? '',
					...timestamps,
				}
			: {
					repositoryIdentity: row.repository_identity,
					kind: 'managed_clone',
					sourceKind: 'managed_clone',
					sourcePath: null,
					...timestamps,
				}
	})
})

export const upsertRepositorySourcePreferencesWithExecutor = Effect.fn(
	'project_workspace.upsert_repository_source_preferences_with_executor',
)(function* (
	db: PostgresTransaction,
	input: RepositoryLocationScope & { readonly sources: RepositorySourceSelections },
) {
	const locations = repositoryLocationsForUserForHost
	const now = yield* Clock.currentTimeMillis
	for (const [repositoryIdentity, source] of Object.entries(input.sources).sort(([a], [b]) => a.localeCompare(b))) {
		yield* Match.value(source).pipe(
			Match.when({ kind: 'unknown' }, () =>
				db.query(
					db.client
						.delete(locations)
						.where(
							and(
								eq(locations.organization_id, input.organizationId),
								eq(locations.user_id, input.userId),
								eq(locations.host_id, input.hostId),
								eq(locations.repository_identity, repositoryIdentity),
							),
						),
				),
			),
			Match.when({ kind: 'filesystem' }, ({ path }) =>
				upsertRepositorySourcePreferenceRow(db, {
					...input,
					repositoryIdentity,
					sourceKind: 'filesystem',
					sourcePath: path.trim(),
					now,
				}),
			),
			Match.when({ kind: 'managed_clone' }, () =>
				upsertRepositorySourcePreferenceRow(db, {
					...input,
					repositoryIdentity,
					sourceKind: 'managed_clone',
					sourcePath: null,
					now,
				}),
			),
			Match.exhaustive,
			captureLocationQueryFailure,
		)
	}
})

function upsertRepositorySourcePreferenceRow(
	db: PostgresTransaction,
	input: RepositoryLocationScope & {
		readonly repositoryIdentity: string
		readonly sourceKind: 'filesystem' | 'managed_clone'
		readonly sourcePath: string | null
		readonly now: number
	},
) {
	const locations = repositoryLocationsForUserForHost
	return db.query(
		db.client
			.insert(locations)
			.values({
				organization_id: input.organizationId,
				user_id: input.userId,
				host_id: input.hostId,
				repository_identity: input.repositoryIdentity,
				source_path: input.sourcePath,
				source_kind: input.sourceKind,
			})
			.onConflictDoUpdate({
				target: [
					locations.organization_id,
					locations.user_id,
					locations.host_id,
					locations.repository_identity,
				],
				set: {
					source_path: input.sourcePath,
					source_kind: input.sourceKind,
					updated_at: sql`greatest(${BigInt(input.now)}::bigint, ${locations.updated_at} + 1)`,
				},
			}),
	)
}

// One configured path per organization/user/host/repository. Omission leaves the mapping unchanged.
export const selectRepositoryLocationsWithExecutor = Effect.fn(
	'project_workspace.select_repository_locations_with_executor',
)(function* (
	db: PostgresTransaction,
	input: RepositoryLocationScope & { readonly repositoryPaths: ProjectRepositoryPaths },
) {
	yield* upsertRepositorySourcePreferencesWithExecutor(db, {
		...input,
		sources: Object.fromEntries(
			Object.entries(input.repositoryPaths).map(([identity, path]) => [
				identity,
				{ kind: 'filesystem' as const, path },
			]),
		),
	})
})

export const readRepositoryLocations = Effect.fn('project_workspace.read_repository_locations')(function* (
	input: RepositoryLocationScope & { readonly repositoryIdentities: readonly string[] },
) {
	const db = yield* PostgresDb
	return yield* readRepositoryLocationsWithExecutor(db, input)
})

export const selectRepositoryLocations = Effect.fn('project_workspace.select_repository_locations')(function* (
	input: RepositoryLocationScope & { readonly repositoryPaths: ProjectRepositoryPaths },
) {
	const db = yield* PostgresDb
	return yield* db.transaction((transaction) => selectRepositoryLocationsWithExecutor(transaction, input))
})

export function repositoryLocationsByIdentity(locations: readonly ConfiguredRepositorySourcePreference[]) {
	return new Map(locations.map((location) => [location.repositoryIdentity, location]))
}
