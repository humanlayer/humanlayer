import { Context, Data, Effect, Layer } from 'effect'
import postgres from 'postgres'

import type { OrganizationSeedDefaults } from './manifest'

export const ORGANIZATION_SEED_SQL = `INSERT INTO organizations (id, workos_organization_id, name)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE SET
  workos_organization_id = EXCLUDED.workos_organization_id,
  name = EXCLUDED.name`

export const ORGANIZATION_SETTINGS_SEED_SQL = `INSERT INTO organization_settings (
  organization_id,
  experimental_subagents_enabled,
  haiku_research_subagents_enabled
)
VALUES ($1, true, true)
ON CONFLICT (organization_id) DO UPDATE SET
  experimental_subagents_enabled = EXCLUDED.experimental_subagents_enabled,
  haiku_research_subagents_enabled = EXCLUDED.haiku_research_subagents_enabled`

export interface SeedOrganizationInput {
	readonly databaseUrl: string
	readonly organization: OrganizationSeedDefaults
}

export class OrganizationSeedPersistenceError extends Data.TaggedError('OrganizationSeedPersistenceError')<{
	readonly reason: string
	readonly cause?: unknown
}> {}

export class OrganizationSeedError extends Data.TaggedError('OrganizationSeedError')<{
	readonly reason: string
	readonly cause: OrganizationSeedPersistenceError
}> {}

export interface OrganizationSeedPersistenceShape {
	readonly upsert: (input: SeedOrganizationInput) => Effect.Effect<void, OrganizationSeedPersistenceError>
}

export class OrganizationSeedPersistence extends Context.Service<
	OrganizationSeedPersistence,
	OrganizationSeedPersistenceShape
>()('devstack/OrganizationSeedPersistence') {}

export interface OrganizationSeedShape {
	readonly seed: (input: SeedOrganizationInput) => Effect.Effect<void, OrganizationSeedError>
}

export class OrganizationSeed extends Context.Service<OrganizationSeed, OrganizationSeedShape>()(
	'devstack/OrganizationSeed',
) {}

export const OrganizationSeedPersistenceLive = Layer.succeed(OrganizationSeedPersistence, {
	upsert: ({ databaseUrl, organization }) =>
		Effect.tryPromise({
			try: async () => {
				const sql = postgres(databaseUrl, { max: 1 })
				try {
					await sql.begin(async (transaction) => {
						await transaction.unsafe(ORGANIZATION_SEED_SQL, [
							organization.id,
							organization.workosOrganizationId,
							organization.name,
						])
						await transaction.unsafe(ORGANIZATION_SETTINGS_SEED_SQL, [organization.id])
					})
				} finally {
					await sql.end()
				}
			},
			catch: (cause) => new OrganizationSeedPersistenceError({ reason: String(cause), cause }),
		}).pipe(
			Effect.withSpan('devstack.seed_organization.persist', {
				attributes: { organizationId: organization.id },
			}),
		),
} satisfies OrganizationSeedPersistenceShape)

export const OrganizationSeedLive = Layer.effect(
	OrganizationSeed,
	Effect.gen(function* () {
		const persistence = yield* OrganizationSeedPersistence
		return {
			seed: (input) => {
				const attributes = { organizationId: input.organization.id }
				return persistence.upsert(input).pipe(
					Effect.tapError(() =>
						Effect.logError('Devstack organization seed failed').pipe(Effect.annotateLogs(attributes)),
					),
					Effect.catchTag('OrganizationSeedPersistenceError', (error) =>
						Effect.fail(new OrganizationSeedError({ reason: error.reason, cause: error })),
					),
					Effect.withSpan('devstack.seed_organization', { attributes }),
				)
			},
		} satisfies OrganizationSeedShape
	}),
)
