import { randomUUID } from 'node:crypto'

import { jiraIntegrations } from '@humanlayer/db/tables/jira-integrations'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getOrgSettingsEffectProcedure as liveGetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-get.effect'
import { setOrgSettingsEffectProcedure as liveSetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-set.effect'
import { getUserSettingsEffectProcedure as liveGetUserSettingsProcedure } from '../../src/orpc/api/auth/user/settings-get.effect'
import { disconnectJiraProcedure } from '../../src/orpc/api/integrations/jira/disconnect'
import { getJiraStatusProcedure } from '../../src/orpc/api/integrations/jira/get-status'
import { createMockApiContext, createMockJiraService, createMockWorkosService } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('jira-integration', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let setOrgSettingsProcedure!: typeof liveSetOrgSettingsProcedure
	let getUserSettingsProcedure!: typeof liveGetUserSettingsProcedure
	let getOrgSettingsProcedure!: typeof liveGetOrgSettingsProcedure

	const workos = createMockWorkosService()

	let testCounter = 0
	const getUniqueUserId = () => `user_jira_${++testCounter}`

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
		const testDb = await createTestDb('jira_integration')
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
		const jira = createMockJiraService({
			getIntegrationStatus: async () => ({
				enabled: false,
				connected: false,
				needsReauth: false,
				siteUrl: null,
			}),
		})

		const result = await call(
			getJiraStatusProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeUserAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						jira,
					},
				}),
			},
		)

		expect(result.enabled).toBe(false)
		expect(result.connected).toBe(false)
		expect(result.needsReauth).toBe(false)
		expect(result.siteUrl).toBeNull()
	})

	test('getStatus returns connected when integration exists', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const jira = createMockJiraService({
			getIntegrationStatus: async () => ({
				enabled: true,
				connected: true,
				needsReauth: false,
				siteUrl: 'https://example.atlassian.net',
			}),
		})

		const result = await call(
			getJiraStatusProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeUserAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						jira,
					},
				}),
			},
		)

		expect(result.enabled).toBe(true)
		expect(result.connected).toBe(true)
		expect(result.needsReauth).toBe(false)
		expect(result.siteUrl).toBe('https://example.atlassian.net')
	})

	test('disconnect removes integration and disables org setting', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		let disconnected = false

		const jira = createMockJiraService({
			disconnect: async () => {
				disconnected = true
				return { success: true }
			},
		})

		const result = await call(
			disconnectJiraProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeAdminAuth(userId, orgId),
					services: {
						workos,
						db,
						dbReadReplica: db,
						jira,
					},
				}),
			},
		)

		expect(result.success).toBe(true)
		expect(disconnected).toBe(true)
	})

	test('org settings get/set includes jiraIntegrationEnabled', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const jira = createMockJiraService()

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
						jira,
					},
				}),
			},
		)
		expect(getResult.jiraIntegrationEnabled).toBe(false)

		// SET to true
		const setResult = await call(
			setOrgSettingsProcedure,
			{ jiraIntegrationEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						jira,
					},
				}),
			},
		)
		expect(setResult.jiraIntegrationEnabled).toBe(true)

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
						jira,
					},
				}),
			},
		)
		expect(getAfter.jiraIntegrationEnabled).toBe(true)
	})

	test('user settings effective.jiraEnabled computes from org setting and jira integration', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)
		const jira = createMockJiraService()

		// No integration, org disabled => jiraEnabled = false
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
						jira,
					},
				}),
			},
		)
		expect(result1.effective.jiraEnabled).toBe(false)
		expect(result1.orgSettings.jiraIntegrationEnabled).toBe(false)
		expect(result1.jiraNeedsReauth).toBe(false)
		expect(result1.jiraSiteUrl).toBeNull()

		// Enable org setting, but still no jira integration row => jiraEnabled = false
		await call(
			setOrgSettingsProcedure,
			{ jiraIntegrationEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services: {
						workos,
						db,
						dbReadReplica: db,
						jira,
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
						jira,
					},
				}),
			},
		)
		expect(result2.effective.jiraEnabled).toBe(false)
		expect(result2.orgSettings.jiraIntegrationEnabled).toBe(true)

		// Insert a jira integration row
		await db.insert(jiraIntegrations).values({
			organization_id: orgId,
			cloud_id: 'test-cloud-id',
			site_url: 'https://test.atlassian.net',
			access_token: 'test-access-token',
			refresh_token: 'test-refresh-token',
			token_expires_at: BigInt(Date.now() + 3600 * 1000),
			scopes: 'read:jira-work',
			connected_by: userId,
			needs_reauth: false,
		})

		// Now org enabled + integration present => jiraEnabled = true
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
						jira,
					},
				}),
			},
		)
		expect(result3.effective.jiraEnabled).toBe(true)
		expect(result3.jiraSiteUrl).toBe('https://test.atlassian.net')
		expect(result3.jiraNeedsReauth).toBe(false)
	})
})
