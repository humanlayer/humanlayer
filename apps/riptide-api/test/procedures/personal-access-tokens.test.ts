import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { UserApiKey, UserApiKeyWithValue } from '@workos-inc/node'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { createPersonalAccessTokenProcedure as liveCreateProcedure } from '../../src/orpc/api/auth/user/personal-access-tokens-create.effect'
import { listPersonalAccessTokensProcedure as liveListProcedure } from '../../src/orpc/api/auth/user/personal-access-tokens-list.effect'
import { revokePersonalAccessTokenProcedure as liveRevokeProcedure } from '../../src/orpc/api/auth/user/personal-access-tokens-revoke.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
	makeTestWorkosService,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const token = {
	object: 'api_key',
	id: 'api_key_procedure',
	name: 'Actions',
	owner: { type: 'user', id: 'user_procedure', organizationId: 'workos_org_procedure' },
	obfuscatedValue: 'sk_...procedure',
	createdAt: '2026-08-01T00:00:00.000Z',
	updatedAt: '2026-08-01T00:00:00.000Z',
	expiresAt: '2026-09-01T00:00:00.000Z',
	lastUsedAt: null,
	permissions: [],
} as unknown as UserApiKey

describe('personal access token procedures', () => {
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let organizationId = ''
	const deletedIds: string[] = []

	beforeAll(async () => {
		const testDb = await createTestDb('pat_procedures')
		cleanup = testDb.cleanup
		const [organization] = await testDb.db
			.insert(organizations)
			.values({ name: 'PAT procedures', workos_organization_id: 'workos_org_procedure' })
			.returning()
		if (!organization) throw new Error('Failed to create test organization')
		organizationId = organization.id

		const workos = makeTestWorkosService({
			createUserApiKey: () => Effect.succeed({ ...token, value: 'secret_once' } as UserApiKeyWithValue),
			listUserApiKeys: () => Effect.succeed([token]),
			deleteApiKey: ({ apiKeyId }) => Effect.sync(() => deletedIds.push(apiKeyId)),
		})
		runtime = createRuntimeWithTestPostgresLayer(testDb.db, {
			workos: Layer.succeed(WorkosService, workos),
		})
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	function context() {
		return createMockApiContext({
			auth: createMockApiAuth({
				userId: 'user_procedure',
				organizationId,
				workosOrganizationId: 'workos_org_procedure',
			}),
		})
	}

	test('creates a one-time value and lists metadata without the raw secret', async () => {
		if (!runtime) throw new Error('Test runtime was not initialized')
		const createProcedure = bindProcedureToRuntime(liveCreateProcedure, runtime)
		const listProcedure = bindProcedureToRuntime(liveListProcedure, runtime)

		const created = await call(createProcedure, { name: 'Actions', expiresInDays: 7 }, { context: context() })
		expect(created).toMatchObject({ token: { id: 'api_key_procedure' }, value: 'secret_once' })

		const listed = await call(listProcedure, {}, { context: context() })
		expect(listed.tokens).toEqual([expect.objectContaining({ id: 'api_key_procedure' })])
		expect(listed.tokens[0]).not.toHaveProperty('value')
	})

	test('permanently revokes an owned key and maps an unknown key to NOT_FOUND', async () => {
		if (!runtime) throw new Error('Test runtime was not initialized')
		const revokeProcedure = bindProcedureToRuntime(liveRevokeProcedure, runtime)

		await expect(call(revokeProcedure, { id: 'api_key_procedure' }, { context: context() })).resolves.toEqual({
			success: true,
		})
		expect(deletedIds).toEqual(['api_key_procedure'])
		await expect(call(revokeProcedure, { id: 'unknown' }, { context: context() })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		})
	})
})
