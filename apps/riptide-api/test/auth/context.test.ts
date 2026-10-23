import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { ApiKey } from '@workos-inc/node'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getAuthContext } from '../../src/auth/context'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { generatePortalLinkProcedure } from '../../src/orpc/api/auth/admin/organizations-generate-portal-link'
import { getOrgSettingsEffectProcedure as liveGetOrganizationSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-get.effect'
import { createMockApiContext, createMockWorkosService } from '../mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
	makeTestWorkosService,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const userApiKey = {
	object: 'api_key',
	id: 'api_key_context',
	name: 'Actions',
	owner: { type: 'user', id: 'user_context', organizationId: 'workos_org_context' },
	obfuscatedValue: 'sk_...context',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
	lastUsedAt: null,
	permissions: [],
} as unknown as ApiKey

describe('user auth context resolution', () => {
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let validationCalls = 0

	beforeAll(async () => {
		const testDb = await createTestDb('pat_auth_context')
		cleanup = testDb.cleanup
		await testDb.db.insert(organizations).values({
			name: 'PAT context organization',
			workos_organization_id: 'workos_org_context',
		})
		const workos = makeTestWorkosService({
			validateApiKey: () => {
				validationCalls += 1
				return Effect.succeed(userApiKey)
			},
		})
		runtime = createRuntimeWithTestPostgresLayer(testDb.db, {
			workos: Layer.succeed(WorkosService, workos),
		})
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	}, 30_000)

	test('validates a PAT on every request and projects a non-admin organization context', async () => {
		if (!runtime) throw new Error('Test runtime was not initialized')
		const request = new Request('http://localhost/rpc/api/v1/auth/user/info', {
			headers: { authorization: 'Bearer workos_pat_value' },
		})

		const first = await getAuthContext(request, runtime)
		const second = await getAuthContext(request, runtime)

		expect(validationCalls).toBe(2)
		expect(first).toEqual(second)
		expect(first).toMatchObject({
			userId: 'user_context',
			workosOrganizationId: 'workos_org_context',
			role: 'member',
			roles: ['member'],
		})
	})

	test('uses the same classic and Effect admin authorization bases and remains non-admin', async () => {
		if (!runtime) throw new Error('Test runtime was not initialized')
		const auth = await getAuthContext(
			new Request('http://localhost', { headers: { authorization: 'Bearer workos_pat_value' } }),
			runtime,
		)
		if (!auth?.organizationId || !auth.workosOrganizationId) throw new Error('Expected an organization context')
		const context = createMockApiContext({
			auth,
			services: { workos: createMockWorkosService() },
		})

		await expect(
			call(generatePortalLinkProcedure, { intent: 'domain_verification' }, { context }),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})

		const getOrganizationSettingsProcedure = bindProcedureToRuntime(liveGetOrganizationSettingsProcedure, runtime)
		await expect(call(getOrganizationSettingsProcedure, {}, { context })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
	})
})
