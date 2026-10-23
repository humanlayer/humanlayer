import { drizzle } from 'drizzle-orm/postgres-js'
import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import postgres from 'postgres'

import { makeEffectPostgresDbService, PostgresDb, type EffectPostgresDbService } from '../postgres/postgres-db.service'
import { backfillCollaborationMilestones } from './backfill-collaboration-milestones'
import {
	CollaborationBackfillCommandInput,
	CollaborationBackfillInvalidInput,
	CollaborationBackfillTarget,
} from './onboarding-collaboration.schemas'

export interface CollaborationBackfillDatabaseResource {
	readonly database: EffectPostgresDbService
	readonly close: Effect.Effect<void>
}

export class CollaborationBackfillDatabase extends Context.Service<
	CollaborationBackfillDatabase,
	{
		readonly open: (databaseUrl: Redacted.Redacted<string>) => Effect.Effect<CollaborationBackfillDatabaseResource>
	}
>()('onboarding/CollaborationBackfillDatabase') {
	static readonly layer = Layer.succeed(
		this,
		this.of({
			open: (databaseUrl) =>
				Effect.sync(() => {
					const client = postgres(Redacted.value(databaseUrl), { max: 5 })
					return {
						database: makeEffectPostgresDbService(drizzle(client)),
						close: Effect.promise(() => client.end({ timeout: 5 })),
					}
				}),
		}),
	)
}

/** Parses operational targeting before opening the command-owned database pool. */
export const runCollaborationBackfillCommand = Effect.fn('onboarding.runCollaborationBackfillCommand')(function* (
	rawInput: unknown,
) {
	const input = yield* Schema.decodeUnknownEffect(CollaborationBackfillCommandInput)(rawInput).pipe(
		Effect.mapError(() => new CollaborationBackfillInvalidInput({ message: 'Invalid command input' })),
	)
	if ((input.organizationId !== null) === input.allOrganizations) {
		return yield* new CollaborationBackfillInvalidInput({
			message: 'Specify exactly one of --organization-id or --all-organizations',
		})
	}

	const target =
		input.organizationId === null
			? CollaborationBackfillTarget.cases.AllOrganizations.make({})
			: CollaborationBackfillTarget.cases.Organization.make({ organizationId: input.organizationId })
	const databaseUrl = yield* Config.Redacted('DATABASE_URL')
	const databaseFactory = yield* CollaborationBackfillDatabase

	return yield* Effect.acquireUseRelease(
		databaseFactory.open(databaseUrl),
		(resource) =>
			backfillCollaborationMilestones({ target, apply: input.apply }).pipe(
				Effect.provideService(PostgresDb, resource.database),
			),
		(resource) => resource.close,
	)
})
