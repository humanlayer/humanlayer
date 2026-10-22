import { organizations } from '@humanlayer/db/tables/organizations'
import type { ApiKey, UserApiKey, UserApiKeyWithValue } from '@workos-inc/node'
import { Effect, Layer, Redacted } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
	authenticatePersonalAccessToken,
	createPersonalAccessToken,
	listPersonalAccessTokens,
	PersonalAccessTokenNotFoundError,
	revokePersonalAccessToken,
} from '../../src/auth/personal-access-tokens'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const userKey = (overrides: Partial<UserApiKey> = {}): UserApiKey =>
	({
		object: 'api_key',
		id: 'api_key_1',
		name: 'Actions',
		obfuscatedValue: 'sk_...1234',
		owner: { type: 'user', id: 'user_1', organizationId: 'workos_org_1' },
		createdAt: '2026-08-01T00:00:00.000Z',
		updatedAt: '2026-08-01T00:00:00.000Z',
		expiresAt: '2026-09-01T00:00:00.000Z',
		lastUsedAt: null,
		permissions: [],
		...overrides,
	}) as UserApiKey

const validatedKey = (owner: ApiKey['owner']): ApiKey => ({ ...userKey(), owner }) as unknown as ApiKey

describe('personal access token policy', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db']
	let cleanup: (() => Promise<void>) | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('personal_access_tokens')
		db = testDb.db
		cleanup = testDb.cleanup
		await db.insert(organizations).values({
			name: 'PAT test organization',
			workos_organization_id: 'workos_org_1',
		})
	}, 60_000)

	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	const run = <A, E>(
		effect: Effect.Effect<
			A,
			E,
			WorkosService | import('../../src/effects/services/postgres/postgres-db.service').PostgresDb
		>,
		service: typeof WorkosService.Service,
	) =>
		Effect.runPromise(
			effect.pipe(Effect.provide(Layer.mergeAll(Layer.succeed(WorkosService, service), PostgresDbLive(db)))),
		)

	test('creates a token with the selected expiry and keeps its raw value redacted', async () => {
		let receivedExpiresAt: Date | undefined
		const service = makeTestWorkosService({
			createUserApiKey: (input) => {
				receivedExpiresAt = input.expiresAt
				return Effect.succeed({ ...userKey(), value: 'secret_pat' } as UserApiKeyWithValue)
			},
		})
		const before = Date.now()
		const result = await run(
			createPersonalAccessToken({
				userId: 'user_1',
				workosOrganizationId: 'workos_org_1',
				name: 'Actions',
				expiresInDays: 7,
			}),
			service,
		)

		expect(receivedExpiresAt?.getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000)
		expect(Redacted.value(result.value)).toBe('secret_pat')
		expect(result.token).not.toHaveProperty('value')
	})

	test('lists metadata and only revokes a key owned by the selected user and organization', async () => {
		const deleted: string[] = []
		const service = makeTestWorkosService({
			listUserApiKeys: () => Effect.succeed([userKey()]),
			deleteApiKey: ({ apiKeyId }) => Effect.sync(() => deleted.push(apiKeyId)),
		})

		const listed = await run(
			listPersonalAccessTokens({ userId: 'user_1', workosOrganizationId: 'workos_org_1' }),
			service,
		)
		expect(listed).toEqual([expect.objectContaining({ id: 'api_key_1', obfuscatedValue: 'sk_...1234' })])
		expect(listed[0]).not.toHaveProperty('value')

		await run(
			revokePersonalAccessToken({ userId: 'user_1', workosOrganizationId: 'workos_org_1', id: 'api_key_1' }),
			service,
		)
		expect(deleted).toEqual(['api_key_1'])

		await expect(
			run(
				revokePersonalAccessToken({ userId: 'user_1', workosOrganizationId: 'workos_org_1', id: 'other' }),
				service,
			),
		).rejects.toBeInstanceOf(PersonalAccessTokenNotFoundError)
	})

	test('rejects invalid and organization-owned keys without constructing a user context', async () => {
		for (const key of [null, validatedKey({ type: 'organization', id: 'workos_org_1' })]) {
			const service = makeTestWorkosService({ validateApiKey: () => Effect.succeed(key) })
			await expect(run(authenticatePersonalAccessToken({ value: 'pat' }), service)).resolves.toBeNull()
		}
	})

	test('maps a validated user key to the internal organization as a non-admin context', async () => {
		const service = makeTestWorkosService({
			validateApiKey: () =>
				Effect.succeed(validatedKey({ type: 'user', id: 'user_1', organizationId: 'workos_org_1' })),
		})
		const context = await run(authenticatePersonalAccessToken({ value: 'pat' }), service)

		expect(context).toMatchObject({
			userId: 'user_1',
			workosOrganizationId: 'workos_org_1',
			role: 'member',
			roles: ['member'],
			permissions: [],
			entitlements: [],
		})
		expect(context?.organizationId).toBeTruthy()
	})

	test('rejects a valid user key when its WorkOS organization has no internal mapping', async () => {
		const service = makeTestWorkosService({
			validateApiKey: () =>
				Effect.succeed(validatedKey({ type: 'user', id: 'user_1', organizationId: 'workos_org_missing' })),
		})

		await expect(run(authenticatePersonalAccessToken({ value: 'pat' }), service)).resolves.toBeNull()
	})
})
