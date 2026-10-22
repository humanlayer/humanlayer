import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

import {
	ORGANIZATION_SEED_SQL,
	ORGANIZATION_SETTINGS_SEED_SQL,
	OrganizationSeed,
	OrganizationSeedLive,
	OrganizationSeedPersistence,
	OrganizationSeedPersistenceError,
	type OrganizationSeedPersistenceShape,
} from '../lib/seed'

const input = {
	databaseUrl: 'postgres://local-devstack',
	organization: { id: 'organization-id', workosOrganizationId: 'workos-id', name: 'Local Org' },
}

const makeLayer = (persistence: OrganizationSeedPersistenceShape) =>
	OrganizationSeedLive.pipe(Layer.provide(Layer.succeed(OrganizationSeedPersistence, persistence)))

describe.skipIf(Boolean(process.env.CI))('OrganizationSeed', () => {
	it('uses narrow upserts for organization identity and owned research settings', () => {
		expect(ORGANIZATION_SEED_SQL).toContain('workos_organization_id = EXCLUDED.workos_organization_id')
		expect(ORGANIZATION_SEED_SQL).toContain('name = EXCLUDED.name')
		expect(ORGANIZATION_SETTINGS_SEED_SQL).toContain('experimental_subagents_enabled = EXCLUDED')
		expect(ORGANIZATION_SETTINGS_SEED_SQL).toContain('haiku_research_subagents_enabled = EXCLUDED')
		expect(ORGANIZATION_SETTINGS_SEED_SQL).not.toContain('billing')
	})

	it.effect('upserts through the persistence seam and remains idempotent', () => {
		const organizations = new Map<string, { workosOrganizationId: string; name: string }>()
		const persistence: OrganizationSeedPersistenceShape = {
			upsert: ({ organization }) =>
				Effect.sync(() => {
					organizations.set(organization.id, {
						workosOrganizationId: organization.workosOrganizationId,
						name: organization.name,
					})
				}),
		}

		return Effect.gen(function* () {
			const seed = yield* OrganizationSeed
			yield* seed.seed(input)
			yield* seed.seed(input)
			expect([...organizations.entries()]).toEqual([
				['organization-id', { workosOrganizationId: 'workos-id', name: 'Local Org' }],
			])
		}).pipe(Effect.provide(makeLayer(persistence)))
	})

	it.effect('captures persistence failures before exposing the public seed error', () => {
		const persistenceError = new OrganizationSeedPersistenceError({ reason: 'database unavailable' })
		const persistence: OrganizationSeedPersistenceShape = {
			upsert: () => Effect.fail(persistenceError),
		}

		return Effect.gen(function* () {
			const seed = yield* OrganizationSeed
			const error = yield* seed.seed(input).pipe(Effect.flip)
			expect(error).toMatchObject({ _tag: 'OrganizationSeedError', reason: 'database unavailable' })
			expect(error.cause).toBe(persistenceError)
		}).pipe(Effect.provide(makeLayer(persistence)))
	})
})
