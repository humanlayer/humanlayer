import { describe, it } from '@effect/vitest'
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Ref } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import {
	CollaborationBackfillDatabase,
	runCollaborationBackfillCommand,
} from '../../src/effects/services/onboarding/backfill-collaboration-command'
import { PostgresDbQueryError } from '../../src/effects/services/postgres/postgres-db.errors'
import {
	makeEffectPostgresDbService,
	type EffectPostgresDbService,
} from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('runCollaborationBackfillCommand', () => {
	const missingOrganizationId = '00000000-0000-0000-0000-000000000999'
	let cleanupTestDb: (() => Promise<void>) | undefined
	let database: EffectPostgresDbService

	beforeAll(async () => {
		const testDb = await createTestDb('collaboration_backfill_command')
		cleanupTestDb = testDb.cleanup
		database = makeEffectPostgresDbService(testDb.db)
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const configLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: 'primary-only-test-url' }))

	function recordingLayer(input: {
		readonly database: EffectPostgresDbService
		readonly opened: Ref.Ref<number>
		readonly closed: Ref.Ref<number>
	}) {
		return Layer.succeed(
			CollaborationBackfillDatabase,
			CollaborationBackfillDatabase.of({
				open: () =>
					Ref.update(input.opened, (count) => count + 1).pipe(
						Effect.as({
							database: input.database,
							close: Ref.update(input.closed, (count) => count + 1),
						}),
					),
			}),
		)
	}

	function run(
		input: unknown,
		databaseService: EffectPostgresDbService,
		opened: Ref.Ref<number>,
		closed: Ref.Ref<number>,
	) {
		return runCollaborationBackfillCommand(input).pipe(
			Effect.provide(recordingLayer({ database: databaseService, opened, closed })),
			Effect.provide(configLayer),
		)
	}

	it.effect('uses only primary config and releases its pool after success and persistence failure', () =>
		Effect.gen(function* () {
			const opened = yield* Ref.make(0)
			const closed = yield* Ref.make(0)
			const success = yield* run(
				{ organizationId: missingOrganizationId, allOrganizations: false, apply: false },
				database,
				opened,
				closed,
			)
			expect(success).toMatchObject({ ownersChecked: 0, failed: false })

			const persistenceError = PostgresDbQueryError.fromCause({ code: 'ECONNREFUSED' })
			const failingDatabase: EffectPostgresDbService = {
				...database,
				query: () => Effect.fail(persistenceError),
			}
			const failure = yield* run(
				{ organizationId: missingOrganizationId, allOrganizations: false, apply: false },
				failingDatabase,
				opened,
				closed,
			).pipe(Effect.flip)

			expect(failure._tag).toBe('CollaborationBackfillPersistenceUnavailable')
			expect(yield* Ref.get(opened)).toBe(2)
			expect(yield* Ref.get(closed)).toBe(2)
		}),
	)

	it.effect('rejects unsafe targets before opening a connection', () =>
		Effect.gen(function* () {
			const opened = yield* Ref.make(0)
			const closed = yield* Ref.make(0)
			for (const input of [
				{ organizationId: null, allOrganizations: false, apply: false },
				{ organizationId: 'org-a', allOrganizations: true, apply: false },
			]) {
				const failure = yield* run(input, database, opened, closed).pipe(Effect.flip)
				expect(failure._tag).toBe('CollaborationBackfillInvalidInput')
			}
			expect(yield* Ref.get(opened)).toBe(0)
			expect(yield* Ref.get(closed)).toBe(0)
		}),
	)

	it.effect('releases its pool when interrupted during a scan', () =>
		Effect.gen(function* () {
			const opened = yield* Ref.make(0)
			const closed = yield* Ref.make(0)
			const scanStarted = yield* Deferred.make<void>()
			const blockedDatabase: EffectPostgresDbService = {
				...database,
				query: <A>() =>
					Deferred.succeed(scanStarted, undefined).pipe(Effect.andThen(Effect.never)) as Effect.Effect<
						A,
						PostgresDbQueryError
					>,
			}
			const fiber = yield* run(
				{ organizationId: missingOrganizationId, allOrganizations: false, apply: false },
				blockedDatabase,
				opened,
				closed,
			).pipe(Effect.forkChild)
			yield* Deferred.await(scanStarted)
			yield* Fiber.interrupt(fiber)

			expect(yield* Ref.get(opened)).toBe(1)
			expect(yield* Ref.get(closed)).toBe(1)
		}),
	)
})
