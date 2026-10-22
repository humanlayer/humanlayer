import { randomUUID } from 'node:crypto'

import { linearIntegrations } from '@humanlayer/db/tables/linear-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { LinearIssueUnavailableError } from '../../src/lib/linear-service'
import { getOrgSettingsEffectProcedure as liveGetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-get.effect'
import { setOrgSettingsEffectProcedure as liveSetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-set.effect'
import { getUserSettingsEffectProcedure as liveGetUserSettingsProcedure } from '../../src/orpc/api/auth/user/settings-get.effect'
import { disconnectLinearProcedure } from '../../src/orpc/api/integrations/linear/disconnect'
import { getLinearIssueProcedure } from '../../src/orpc/api/integrations/linear/get-issue'
import { getLinearIssueMetadataProcedure } from '../../src/orpc/api/integrations/linear/get-issue-metadata'
import { getLinearStatusProcedure } from '../../src/orpc/api/integrations/linear/get-status'
import { createMockApiContext, createMockLinearService, createMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('linear-integration', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let setOrgSettingsProcedure!: typeof liveSetOrgSettingsProcedure
	let getUserSettingsProcedure!: typeof liveGetUserSettingsProcedure
	let getOrgSettingsProcedure!: typeof liveGetOrgSettingsProcedure

	const workos = createMockWorkosService()

	let testCounter = 0
	const getUniqueUserId = () => `user_linear_${++testCounter}`

	const createTestOrg = async () => {
		const id = randomUUID()
		const [org] = await db
			.insert(organizations)
			.values({ name: `Test Org ${id}`, workos_organization_id: `workos-org-${id}` })
			.returning()
		return org!.id
	}

	const makeUserAuth = (userId: string, organizationId: string) => ({
		userId,
		organizationId,
		workosOrganizationId: `workos-org-${organizationId}`,
		role: '',
		roles: [] as string[],
		permissions: [] as string[],
		entitlements: [] as string[],
		sessionId: 'test-session',
	})

	const makeAdminAuth = (userId: string, organizationId: string) => ({
		userId,
		organizationId,
		workosOrganizationId: `workos-org-${organizationId}`,
		role: 'admin',
		roles: ['admin'],
		permissions: [] as string[],
		entitlements: [] as string[],
		sessionId: 'test-session',
	})

	beforeAll(async () => {
		const testDb = await createTestDb('linear_integration')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		setOrgSettingsProcedure = bindProcedureToRuntime(liveSetOrgSettingsProcedure, effectRuntime)
		getUserSettingsProcedure = bindProcedureToRuntime(liveGetUserSettingsProcedure, effectRuntime)
		getOrgSettingsProcedure = bindProcedureToRuntime(liveGetOrgSettingsProcedure, effectRuntime)
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	test('getStatus returns not connected when no integration exists', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const linear = createMockLinearService({
			getIntegrationStatus: async () => ({
				enabled: false,
				connected: false,
				needsReauth: false,
			}),
		})

		const result = await call(
			getLinearStatusProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeUserAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)

		expect(result.enabled).toBe(false)
		expect(result.connected).toBe(false)
		expect(result.needsReauth).toBe(false)
	})

	test.each([
		['metadata', getLinearIssueMetadataProcedure, 'getIssueMetadata'],
		['full issue', getLinearIssueProcedure, 'getIssue'],
	] as const)('returns typed unavailable-ticket data from %s lookup', async (_name, procedure, method) => {
		const orgId = await createTestOrg()
		const linear = createMockLinearService({
			[method]: async () => {
				throw new LinearIssueUnavailableError('cpq-116')
			},
		})

		await expect(
			call(
				procedure,
				{ issueId: 'cpq-116' },
				{
					context: createMockApiContext({
						auth: makeUserAuth(getUniqueUserId(), orgId),
						services: { workos, db, dbReadReplica: db, linear },
					}),
				},
			),
		).rejects.toMatchObject({
			code: 'NOT_FOUND',
			data: {
				message:
					"Couldn't load Linear ticket CPQ-116. It may not exist, or the Linear integration may not have access to its team/subteam.",
				resolutionHint: { text: 'Check your Linear integration', anchorText: 'settings' },
			},
		})
	})

	test('keeps unknown Linear lookup failures generic', async () => {
		const orgId = await createTestOrg()
		const linear = createMockLinearService({
			getIssueMetadata: async () => {
				throw new Error('provider secret')
			},
		})

		await expect(
			call(
				getLinearIssueMetadataProcedure,
				{ issueId: 'CPQ-116' },
				{
					context: createMockApiContext({
						auth: makeUserAuth(getUniqueUserId(), orgId),
						services: { workos, db, dbReadReplica: db, linear },
					}),
				},
			),
		).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR', data: undefined })
	})

	test('getStatus returns connected when integration exists', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const linear = createMockLinearService({
			getIntegrationStatus: async () => ({
				enabled: true,
				connected: true,
				needsReauth: false,
			}),
		})

		const result = await call(
			getLinearStatusProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeUserAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)

		expect(result.enabled).toBe(true)
		expect(result.connected).toBe(true)
		expect(result.needsReauth).toBe(false)
	})

	test('disconnect calls through to linear.disconnect', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		let disconnected = false

		const linear = createMockLinearService({
			disconnect: async () => {
				disconnected = true
				return { success: true }
			},
		})

		const result = await call(
			disconnectLinearProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeAdminAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)

		expect(result.success).toBe(true)
		expect(disconnected).toBe(true)
	})

	test('org settings get/set includes linearIntegrationEnabled', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const linear = createMockLinearService()

		// GET defaults to false
		const getResult = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(getResult.linearIntegrationEnabled).toBe(false)

		// SET to true
		const setResult = await call(
			setOrgSettingsProcedure,
			{ linearIntegrationEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(setResult.linearIntegrationEnabled).toBe(true)

		// GET returns true
		const getAfter = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(getAfter.linearIntegrationEnabled).toBe(true)
	})

	test('user settings effective.linearEnabled computes from org setting and linear integration', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)
		const linear = createMockLinearService()

		// No integration, org disabled => linearEnabled = false
		const result1 = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(result1.effective.linearEnabled).toBe(false)
		expect(result1.orgSettings.linearIntegrationEnabled).toBe(false)
		expect(result1.linearNeedsReauth).toBe(false)

		// Enable org setting, but still no linear integration row => linearEnabled = false
		await call(
			setOrgSettingsProcedure,
			{ linearIntegrationEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)

		const result2 = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(result2.effective.linearEnabled).toBe(false)
		expect(result2.orgSettings.linearIntegrationEnabled).toBe(true)

		// Insert a linear integration row
		await db.insert(linearIntegrations).values({
			organization_id: orgId,
			access_token: 'test-access-token',
			refresh_token: 'test-refresh-token',
			token_expires_at: BigInt(Date.now() + 3600 * 1000),
			scopes: 'read,write,comments:create',
			connected_by: userId,
			needs_reauth: false,
		})

		// Now org enabled + integration present => linearEnabled = true
		const result3 = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						linear,
					},
				}),
			},
		)
		expect(result3.effective.linearEnabled).toBe(true)
		expect(result3.linearNeedsReauth).toBe(false)
	})
})
