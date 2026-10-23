import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import { githubIntegrations } from '@humanlayer/db/tables/github-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import {
	ExperimentAnalyticsService,
	type RecordProjectsV2AssignedInput,
} from '../../src/effects/services/experiment-analytics/experiment-analytics.service'
import { getOrgSettingsEffectProcedure as liveGetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-get.effect'
import { setOrgSettingsEffectProcedure as liveSetOrgSettingsProcedure } from '../../src/orpc/api/auth/admin/organizations-settings-set.effect'
import { setAdminUserMetricsAdvancedProcedure } from '../../src/orpc/api/auth/admin/users-set-metrics-advanced'
import { getUserInfoEffectProcedure as liveGetUserInfoProcedure } from '../../src/orpc/api/auth/user/info.effect'
import { getUserSettingsEffectProcedure as liveGetUserSettingsProcedure } from '../../src/orpc/api/auth/user/settings-get.effect'
import { updateUserSettingsEffectProcedure as liveUpdateUserSettingsProcedure } from '../../src/orpc/api/auth/user/settings-update.effect'
import { syncV2SessionsProcedure } from '../../src/orpc/api/sync/v2/sessions'
import { daemonGetSettingsEffectProcedure as liveDaemonGetSettingsProcedure } from '../../src/orpc/daemon/settings/get.effect'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import {
	createMockApiContext,
	createMockDaemonContext,
	createMockStripeService,
	createMockWorkosService,
} from '../mocks'
import { StatefulMockWorkosService } from '../mocks/workos-service.mock'
import {
	bindProcedureToRuntime,
	billingPriceIdsLayer,
	createRuntimeWithTestPostgresLayer,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('settings', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let daemonGetSettingsProcedure: typeof liveDaemonGetSettingsProcedure
	let getUserSettingsProcedure!: typeof liveGetUserSettingsProcedure
	let updateUserSettingsProcedure!: typeof liveUpdateUserSettingsProcedure
	let getOrgSettingsProcedure!: typeof liveGetOrgSettingsProcedure
	let setOrgSettingsProcedure!: typeof liveSetOrgSettingsProcedure
	let getUserInfoProcedure!: typeof liveGetUserInfoProcedure

	const workos = createMockWorkosService()
	const stripe = createMockStripeService()
	const services = {
		workos,
		get db() {
			return db
		},
		get dbReadReplica() {
			return db
		},
		stripe,
	}

	// Each test uses a unique userId to avoid inter-test interference
	let testCounter = 0
	const getUniqueUserId = () => `user_settings_${++testCounter}`

	// Each test gets its own org to avoid shared mutable state under --concurrent
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
		workosOrganizationId: 'workos-org-settings',
		role: '',
		roles: [] as string[],
		permissions: [] as string[],
		entitlements: [] as string[],
		sessionId: 'test-session',
	})

	const makeAdminAuth = (userId: string, organizationId: string) => ({
		userId,
		organizationId,
		workosOrganizationId: 'workos-org-settings',
		role: 'admin',
		roles: ['admin'],
		permissions: [] as string[],
		entitlements: [] as string[],
		sessionId: 'test-session',
	})

	const makeDaemonAuth = (userId: string, organizationId: string) => ({
		userId,
		organizationId,
		hostId: 'test-host',
	})

	const planRuntimes: ReturnType<typeof createRuntimeWithTestPostgresLayer>[] = []

	// Procedures bound to a runtime whose billing KV holds the given plan for the org.
	const proceduresOnPlan = async (organizationId: string, priceId: string, kv = new TestBillingKvService()) => {
		const customerId = `cus_${organizationId}`
		await kv.setOrgCustomerId(organizationId, customerId)
		await kv.setSubscriptionCache(customerId, {
			customerId,
			organizationId,
			subscriptionId: 'sub_test',
			status: 'active',
			priceId,
			currentPeriodEnd: null,
			hasPaidInvoice: true,
			hasPaymentMethod: true,
			pastDueAt: null,
			syncedAt: Date.now(),
		})
		return proceduresOnBillingKv(kv)
	}

	const proceduresOnBillingKv = (kv: TestBillingKvService) => {
		const runtime = createRuntimeWithTestPostgresLayer(db, {
			billingKv: billingKvLayerFromTestService(kv),
			billingPriceIds: billingPriceIdsLayer({ starter: 'price_starter', pro: 'price_pro' }),
		})
		planRuntimes.push(runtime)
		return {
			getUserInfo: bindProcedureToRuntime(liveGetUserInfoProcedure, runtime),
			setOrgSettings: bindProcedureToRuntime(liveSetOrgSettingsProcedure, runtime),
		}
	}

	class DownBillingKvService extends TestBillingKvService {
		override async getOrgCustomerId(): Promise<string | null> {
			throw new Error('billing kv down')
		}
	}

	beforeAll(async () => {
		const testDb = await createTestDb('settings')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		daemonGetSettingsProcedure = bindProcedureToRuntime(liveDaemonGetSettingsProcedure, effectRuntime)
		getUserSettingsProcedure = bindProcedureToRuntime(liveGetUserSettingsProcedure, effectRuntime)
		getOrgSettingsProcedure = bindProcedureToRuntime(liveGetOrgSettingsProcedure, effectRuntime)
		setOrgSettingsProcedure = bindProcedureToRuntime(liveSetOrgSettingsProcedure, effectRuntime)
		getUserInfoProcedure = bindProcedureToRuntime(liveGetUserInfoProcedure, effectRuntime)
		updateUserSettingsProcedure = bindProcedureToRuntime(liveUpdateUserSettingsProcedure, effectRuntime)
	}, 60000)

	afterAll(async () => {
		await Promise.all(planRuntimes.map((runtime) => runtime.dispose()))
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	test('user settings GET returns defaults when no rows exist', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const result = await call(
			getUserSettingsProcedure,
			{},
			{ context: createMockApiContext({ auth: makeUserAuth(userId, orgId), services }) },
		)

		expect(result.userSettings.theme).toBe('catppuccin')
		expect(result.userSettings.experimentalSubagentsEnabled).toBe(false)
		expect(result.userSettings.claudeCodeEffectRuntimeEnabled).toBe(false)
		expect(result.effective.claudeCodeEffectRuntimeEnabled).toBe(false)
		expect(result.orgSettings.experimentalSubagentsEnabled).toBe(false)
		expect(result.orgSettings.multiplayerPromptingEnabled).toBe(false)
		expect(result.orgSettings.syncVersion).toBe(2)
		expect(result.orgSettings.syncVisibility).toBe('v2')
		expect(result.effective.experimentalSubagentsEnabled).toBe(false)
		expect(result.userSettings.onboardingDismissedAt).toBeNull()
		expect(result.userSettings.firstTaskCompletedAt).toBeNull()
		expect(result.userSettings.firstStructuredWorkflowCompletedAt).toBeNull()
		expect(result.userSettings.firstInboundCommentReceivedAt).toBeNull()
		expect(result.userSettings.projectsV2Enabled).toBe(false)
		expect(result.userSettings.projectsV2AssignedVariant).toBeNull()
		expect(result.userSettings.projectsV2AssignedAt).toBeNull()
		expect(result.userSettings.experiments).toEqual({})
	})

	test('experiment flags merge per key and survive unrelated updates', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)
		const context = createMockApiContext({ auth, services })

		const first = await call(
			updateUserSettingsProcedure,
			{ experiments: { githubPrPanelEnabled: true } },
			{ context },
		)
		expect(first.userSettings.experiments).toEqual({ githubPrPanelEnabled: true })

		const second = await call(
			updateUserSettingsProcedure,
			{ experiments: { roundedCornersEnabled: true } },
			{ context },
		)
		expect(second.userSettings.experiments).toEqual({ githubPrPanelEnabled: true, roundedCornersEnabled: true })

		const sparseUpdate = await call(updateUserSettingsProcedure, { theme: 'monokai' }, { context })
		expect(sparseUpdate.userSettings.experiments).toEqual({
			githubPrPanelEnabled: true,
			roundedCornersEnabled: true,
		})

		const flippedOff = await call(
			updateUserSettingsProcedure,
			{ experiments: { githubPrPanelEnabled: false } },
			{ context },
		)
		expect(flippedOff.userSettings.experiments).toEqual({
			githubPrPanelEnabled: false,
			roundedCornersEnabled: true,
		})

		const persisted = await call(getUserSettingsProcedure, {}, { context })
		expect(persisted.userSettings.experiments).toEqual({ githubPrPanelEnabled: false, roundedCornersEnabled: true })
	})

	test('Projects V2 defaults off, supports opt-in and sparse updates, and ignores opt-out', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)
		const context = createMockApiContext({ auth, services })

		const enabled = await call(updateUserSettingsProcedure, { projectsV2Enabled: true }, { context })
		expect(enabled.userSettings.projectsV2Enabled).toBe(true)
		expect(enabled.userSettings.projectsV2AssignedVariant).toBeNull()
		expect(enabled.userSettings.projectsV2AssignedAt).toBeNull()

		const sparseUpdate = await call(updateUserSettingsProcedure, { theme: 'monokai' }, { context })
		expect(sparseUpdate.userSettings.projectsV2Enabled).toBe(true)

		const persistedEnabled = await call(getUserSettingsProcedure, {}, { context })
		expect(persistedEnabled.userSettings.projectsV2Enabled).toBe(true)

		const disabled = await call(updateUserSettingsProcedure, { projectsV2Enabled: false }, { context })
		expect(disabled.userSettings.projectsV2Enabled).toBe(true)

		const persistedAfterOptOut = await call(getUserSettingsProcedure, {}, { context })
		expect(persistedAfterOptOut.userSettings.projectsV2Enabled).toBe(true)
	})

	test('Projects V2 opt-out on a new settings row stays off', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const context = createMockApiContext({ auth: makeUserAuth(userId, orgId), services })

		const result = await call(updateUserSettingsProcedure, { projectsV2Enabled: false }, { context })
		expect(result.userSettings.projectsV2Enabled).toBe(false)
	})

	describe('Projects V2 experiment assignment', () => {
		let assignmentRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
		let updateWithAssignment!: typeof liveUpdateUserSettingsProcedure
		const assignedEvents: RecordProjectsV2AssignedInput[] = []

		beforeAll(() => {
			assignmentRuntime = createRuntimeWithTestPostgresLayer(db, {
				experimentAnalytics: Layer.succeed(ExperimentAnalyticsService, {
					recordTaskComposerTaskCreated: () => Effect.void,
					recordCodingAgentSessionCreated: () => Effect.void,
					recordProjectsV2Assigned: (input) =>
						Effect.sync(() => {
							assignedEvents.push(input)
						}),
				}),
			})
			updateWithAssignment = bindProcedureToRuntime(liveUpdateUserSettingsProcedure, assignmentRuntime)
		})

		afterAll(async () => {
			await assignmentRuntime?.dispose()
		})

		const assignmentContext = async () => {
			const userId = getUniqueUserId()
			const orgId = await createTestOrg()
			return {
				userId,
				orgId,
				context: createMockApiContext({ auth: makeUserAuth(userId, orgId), services }),
			}
		}

		const eventsFor = (userId: string, orgId: string) =>
			assignedEvents.filter((event) => event.userId === userId && event.organizationId === orgId)

		const storedRow = async (userId: string, orgId: string) => {
			const [row] = await db
				.select()
				.from(userSettings)
				.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, orgId)))
			return row
		}

		test('saves a V2 group, turns access on, and sends one event', async () => {
			const { userId, orgId, context } = await assignmentContext()
			const before = Date.now()

			const result = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v2' }, { context })

			expect(result.userSettings.projectsV2AssignedVariant).toBe('v2')
			expect(result.userSettings.projectsV2Enabled).toBe(true)
			expect(result.userSettings.projectsV2AssignedAt).toBeGreaterThanOrEqual(before)
			await vi.waitFor(() => expect(eventsFor(userId, orgId)).toHaveLength(1))
			expect(eventsFor(userId, orgId)[0]).toEqual({
				userId,
				organizationId: orgId,
				assignedVariant: 'v2',
				assignedAt: result.userSettings.projectsV2AssignedAt,
			})

			const persisted = await call(getUserSettingsProcedure, {}, { context })
			expect(persisted.userSettings.projectsV2AssignedVariant).toBe('v2')
			expect(persisted.userSettings.projectsV2AssignedAt).toBe(result.userSettings.projectsV2AssignedAt)
			expect(persisted.userSettings.projectsV2Enabled).toBe(true)
		})

		test('saves a V1 group without turning access on', async () => {
			const { userId, orgId, context } = await assignmentContext()

			const result = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context })

			expect(result.userSettings.projectsV2AssignedVariant).toBe('v1')
			expect(result.userSettings.projectsV2Enabled).toBe(false)
			await vi.waitFor(() => expect(eventsFor(userId, orgId)).toHaveLength(1))
			expect(eventsFor(userId, orgId)[0]?.assignedVariant).toBe('v1')
		})

		test('keeps the first group and timestamp across retries and sends the event once', async () => {
			const { userId, orgId, context } = await assignmentContext()

			const first = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context })
			const repeated = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context })
			const changed = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v2' }, { context })

			for (const result of [repeated, changed]) {
				expect(result.userSettings.projectsV2AssignedVariant).toBe('v1')
				expect(result.userSettings.projectsV2AssignedAt).toBe(first.userSettings.projectsV2AssignedAt)
				expect(result.userSettings.projectsV2Enabled).toBe(false)
			}
			await vi.waitFor(() => expect(eventsFor(userId, orgId)).toHaveLength(1))
			// Give any stray detached fiber a chance to run before asserting there was only one.
			await new Promise((resolve) => setTimeout(resolve, 50))
			expect(eventsFor(userId, orgId)).toHaveLength(1)
		})

		test('keeps one group under concurrent first saves', async () => {
			const { userId, orgId, context } = await assignmentContext()

			const results = await Promise.all([
				call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context }),
				call(updateWithAssignment, { projectsV2AssignedVariant: 'v2' }, { context }),
				call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context }),
			])

			const row = await storedRow(userId, orgId)
			for (const result of results) {
				expect(result.userSettings.projectsV2AssignedVariant).toBe(row?.projects_v2_assigned_variant)
				expect(result.userSettings.projectsV2AssignedAt).toBe(Number(row?.projects_v2_assigned_at))
			}
			await vi.waitFor(() => expect(eventsFor(userId, orgId)).toHaveLength(1))
			await new Promise((resolve) => setTimeout(resolve, 50))
			expect(eventsFor(userId, orgId)).toHaveLength(1)
		})

		test('a V1 group never turns off access that was already on', async () => {
			const { context } = await assignmentContext()

			await call(updateWithAssignment, { projectsV2Enabled: true }, { context })
			const result = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context })

			expect(result.userSettings.projectsV2AssignedVariant).toBe('v1')
			expect(result.userSettings.projectsV2Enabled).toBe(true)
		})

		test('manual opt-in after a V1 group keeps the V1 group', async () => {
			const { userId, orgId, context } = await assignmentContext()

			const assigned = await call(updateWithAssignment, { projectsV2AssignedVariant: 'v1' }, { context })
			const optedIn = await call(updateWithAssignment, { projectsV2Enabled: true }, { context })

			expect(optedIn.userSettings.projectsV2Enabled).toBe(true)
			expect(optedIn.userSettings.projectsV2AssignedVariant).toBe('v1')
			expect(optedIn.userSettings.projectsV2AssignedAt).toBe(assigned.userSettings.projectsV2AssignedAt)

			const optedOut = await call(updateWithAssignment, { projectsV2Enabled: false }, { context })
			expect(optedOut.userSettings.projectsV2Enabled).toBe(true)
			expect(optedOut.userSettings.projectsV2AssignedVariant).toBe('v1')
			await vi.waitFor(() => expect(eventsFor(userId, orgId)).toHaveLength(1))
		})

		test('a false opt-out sent with a V2 group still turns access on', async () => {
			const { context } = await assignmentContext()

			const result = await call(
				updateWithAssignment,
				{ projectsV2AssignedVariant: 'v2', projectsV2Enabled: false },
				{ context },
			)

			expect(result.userSettings.projectsV2AssignedVariant).toBe('v2')
			expect(result.userSettings.projectsV2Enabled).toBe(true)
		})

		test('saves the group per organization', async () => {
			const userId = getUniqueUserId()
			const firstOrg = await createTestOrg()
			const secondOrg = await createTestOrg()

			await call(
				updateWithAssignment,
				{ projectsV2AssignedVariant: 'v2' },
				{ context: createMockApiContext({ auth: makeUserAuth(userId, firstOrg), services }) },
			)
			const second = await call(
				updateWithAssignment,
				{ projectsV2AssignedVariant: 'v2' },
				{ context: createMockApiContext({ auth: makeUserAuth(userId, secondOrg), services }) },
			)

			expect(second.userSettings.projectsV2AssignedVariant).toBe('v2')
			expect(second.userSettings.projectsV2Enabled).toBe(true)
			await vi.waitFor(() => {
				expect(eventsFor(userId, firstOrg)).toHaveLength(1)
				expect(eventsFor(userId, secondOrg)).toHaveLength(1)
			})
		})

		test('rejects an unknown group', async () => {
			const { userId, orgId, context } = await assignmentContext()

			await expect(
				call(updateWithAssignment, { projectsV2AssignedVariant: 'control' } as never, { context }),
			).rejects.toThrow()
			expect(await storedRow(userId, orgId)).toBeUndefined()
		})

		test('the database rejects a group other than v1 or v2', async () => {
			const userId = getUniqueUserId()
			const orgId = await createTestOrg()

			await expect(
				db.insert(userSettings).values({
					user_id: userId,
					organization_id: orgId,
					projects_v2_assigned_variant: 'test' as never,
				}),
			).rejects.toThrow()
		})
	})

	test('user settings GET returns persisted onboarding timestamps', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const timestamps = {
			onboardingDismissedAt: 1_700_000_000_001,
			firstTaskCompletedAt: 1_700_000_000_002,
			firstStructuredWorkflowCompletedAt: 1_700_000_000_003,
			firstInboundCommentReceivedAt: 1_700_000_000_004,
		}
		await db.insert(userSettings).values({
			user_id: userId,
			organization_id: orgId,
			onboarding_dismissed_at: BigInt(timestamps.onboardingDismissedAt),
			first_task_completed_at: BigInt(timestamps.firstTaskCompletedAt),
			first_structured_workflow_completed_at: BigInt(timestamps.firstStructuredWorkflowCompletedAt),
			first_inbound_comment_received_at: BigInt(timestamps.firstInboundCommentReceivedAt),
		})

		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({ auth: makeUserAuth(userId, orgId), services }),
			},
		)

		expect(result.userSettings).toMatchObject(timestamps)
	})

	test('user can set and clear onboarding dismissal without changing milestones', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)
		const dismissedAt = Date.now()

		const dismissed = await call(
			updateUserSettingsProcedure,
			{ onboardingDismissedAt: dismissedAt },
			{ context: createMockApiContext({ auth, services }) },
		)
		expect(dismissed.userSettings.onboardingDismissedAt).toBe(dismissedAt)
		expect(dismissed.userSettings.firstTaskCompletedAt).toBeNull()

		const cleared = await call(
			updateUserSettingsProcedure,
			{ onboardingDismissedAt: null },
			{ context: createMockApiContext({ auth, services }) },
		)
		expect(cleared.userSettings.onboardingDismissedAt).toBeNull()
		expect(cleared.userSettings.firstTaskCompletedAt).toBeNull()
	})

	test('user settings update does not accept milestone timestamps', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)

		const result = await call(
			updateUserSettingsProcedure,
			{
				firstTaskCompletedAt: Date.now(),
				firstStructuredWorkflowCompletedAt: Date.now(),
				firstInboundCommentReceivedAt: Date.now(),
			} as never,
			{ context: createMockApiContext({ auth, services }) },
		)

		expect(result.userSettings.firstTaskCompletedAt).toBeNull()
		expect(result.userSettings.firstStructuredWorkflowCompletedAt).toBeNull()
		expect(result.userSettings.firstInboundCommentReceivedAt).toBeNull()
	})

	test('legacy Claude runtime setting remains API-compatible', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const userAuth = makeUserAuth(userId, orgId)

		const updateResult = await call(
			updateUserSettingsProcedure,
			{ claudeCodeEffectRuntimeEnabled: true },
			{ context: createMockApiContext({ auth: userAuth, services }) },
		)
		expect(updateResult.userSettings.claudeCodeEffectRuntimeEnabled).toBe(true)
		expect(updateResult.effective.claudeCodeEffectRuntimeEnabled).toBe(true)

		const getResult = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({ auth: userAuth, services }),
			},
		)
		expect(getResult.userSettings.claudeCodeEffectRuntimeEnabled).toBe(true)

		const daemonResult = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }),
			},
		)
		expect(daemonResult.claudeCodeEffectRuntimeEnabled).toBe(true)
	})

	test('user settings UPDATE creates row and GET returns it', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)

		const updateResult = await call(
			updateUserSettingsProcedure,
			{ theme: 'monokai' },
			{
				context: createMockApiContext({
					auth,
					services,
				}),
			},
		)
		expect(updateResult.userSettings.theme).toBe('monokai')
		expect(updateResult.orgSettings.syncVersion).toBe(2)
		expect(updateResult.orgSettings.syncVisibility).toBe('v2')
		expect(updateResult.orgSettings.linearIntegrationEnabled).toBe(false)

		const getResult = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth,
					services,
				}),
			},
		)
		expect(getResult.userSettings.theme).toBe('monokai')
	})

	test('user settings UPDATE updates existing row', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const auth = makeUserAuth(userId, orgId)

		// Create initial row
		await call(
			updateUserSettingsProcedure,
			{ theme: 'monokai' },
			{
				context: createMockApiContext({
					auth,
					services,
				}),
			},
		)

		// Update it
		const result = await call(
			updateUserSettingsProcedure,
			{ theme: 'dracula' },
			{
				context: createMockApiContext({
					auth,
					services,
				}),
			},
		)
		expect(result.userSettings.theme).toBe('dracula')
	})

	test('FEATURE_DISABLED_BY_ORG: user cannot enable subagents when org has it disabled', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		await expect(
			call(
				updateUserSettingsProcedure,
				{ experimentalSubagentsEnabled: true },
				{
					context: createMockApiContext({
						auth: makeUserAuth(userId, orgId),
						services,
					}),
				},
			),
		).rejects.toThrow()
	})

	test('admin org settings CRUD flow', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// GET defaults
		const getResult = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getResult.experimentalSubagentsEnabled).toBe(false)
		expect(getResult.syncVersion).toBe(2)
		expect(getResult.syncVisibility).toBe('v2')

		// SET to true
		const setResult = await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setResult.experimentalSubagentsEnabled).toBe(true)
		expect(setResult.syncVersion).toBe(2)
		expect(setResult.syncVisibility).toBe('v2')

		// GET returns true
		const getAfter = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getAfter.experimentalSubagentsEnabled).toBe(true)
	})

	test('multiplayer prompting defaults false, round-trips, projects to users, and preserves sparse settings', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		const defaults = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({ auth: adminAuth, services }),
			},
		)
		expect(defaults.multiplayerPromptingEnabled).toBe(false)

		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({ auth: adminAuth, services }),
			},
		)
		const enabled = await call(
			setOrgSettingsProcedure,
			{ multiplayerPromptingEnabled: true },
			{
				context: createMockApiContext({ auth: adminAuth, services }),
			},
		)
		expect(enabled.multiplayerPromptingEnabled).toBe(true)
		expect(enabled.experimentalSubagentsEnabled).toBe(true)

		const userSettings = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({ auth: userAuth, services }),
			},
		)
		expect(userSettings.orgSettings.multiplayerPromptingEnabled).toBe(true)
	})

	test('admin org settings defaultTaskShareLevel defaults to edit and round-trips read/edit', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		const getResult = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getResult.defaultTaskShareLevel).toBe('edit')

		const setEdit = await call(
			setOrgSettingsProcedure,
			{ defaultTaskShareLevel: 'edit' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setEdit.defaultTaskShareLevel).toBe('edit')

		const getEdit = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getEdit.defaultTaskShareLevel).toBe('edit')

		const setRead = await call(
			setOrgSettingsProcedure,
			{ defaultTaskShareLevel: 'read' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setRead.defaultTaskShareLevel).toBe('read')
	})

	test('admin org settings rejects invalid defaultTaskShareLevel', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		await expect(
			call(
				setOrgSettingsProcedure,
				{ defaultTaskShareLevel: 'comment' as 'read' },
				{
					context: createMockApiContext({
						auth: adminAuth,
						services,
					}),
				},
			),
		).rejects.toThrow()
	})

	test('enableCreatingPubliclyShareableLinks defaults to true, set/get roundtrip, and user settings includes it', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Default is true
		const getResult = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getResult.enableCreatingPubliclyShareableLinks).toBe(true)

		// Set to false
		const setResult = await call(
			setOrgSettingsProcedure,
			{ enableCreatingPubliclyShareableLinks: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setResult.enableCreatingPubliclyShareableLinks).toBe(false)

		// GET returns false after set
		const getAfter = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getAfter.enableCreatingPubliclyShareableLinks).toBe(false)

		// user settings response includes the org setting
		const userSettingsResult = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)
		expect(userSettingsResult.orgSettings.enableCreatingPubliclyShareableLinks).toBe(false)
	})

	test('admin toggle-off revokes existing artifact share links', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// Seed a task and artifact with sharing enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: orgId,
				name: `settings revoke test task ${randomUUID().slice(0, 8)}`,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		const content = `revoke test content ${randomUUID()}`
		const [artifact] = await db
			.insert(artifacts)
			.values({
				task_id: task.id,
				file_name: `revoke-test-${randomUUID().slice(0, 8)}.md`,
				content,
				content_hash: hash(content),
				resource_owner_user_id: userId,
				organization_id: orgId,
				created_by: userId,
				share_key: randomUUID(),
				shared_by: userId,
				share_enabled: true,
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')

		// Verify artifact starts with share_enabled = true
		const [before] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
		expect(before?.share_enabled).toBe(true)

		// Admin disables sharing at org level
		const setResult = await call(
			setOrgSettingsProcedure,
			{ enableCreatingPubliclyShareableLinks: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setResult.enableCreatingPubliclyShareableLinks).toBe(false)

		// The artifact should now have share_enabled = false (bulk revoked)
		const [after] = await db.select().from(artifacts).where(eq(artifacts.id, artifact.id)).limit(1)
		expect(after?.share_enabled).toBe(false)
		// share_key should be preserved (for potential re-enable)
		expect(after?.share_key).toBe(artifact.share_key)
	})

	test('accessRequestsEnabled defaults to true, set/get roundtrip', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// Default is true
		const getResult = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getResult.accessRequestsEnabled).toBe(true)

		// Set to false
		const setResult = await call(
			setOrgSettingsProcedure,
			{ accessRequestsEnabled: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setResult.accessRequestsEnabled).toBe(false)

		// GET returns false after set
		const getAfterDisable = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getAfterDisable.accessRequestsEnabled).toBe(false)

		// Set back to true
		const setBackResult = await call(
			setOrgSettingsProcedure,
			{ accessRequestsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(setBackResult.accessRequestsEnabled).toBe(true)

		// GET returns true after re-enable
		const getAfterEnable = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)
		expect(getAfterEnable.accessRequestsEnabled).toBe(true)
	})

	test('disabling accessRequestsEnabled does NOT retroactively archive existing pending requests', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// Seed a task and artifact for this org
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: orgId,
				name: `access-req-disable-test-${randomUUID().slice(0, 8)}`,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		const content = `access request disable test ${randomUUID()}`
		const [artifact] = await db
			.insert(artifacts)
			.values({
				task_id: task.id,
				file_name: `disable-test-${randomUUID().slice(0, 8)}.md`,
				content,
				content_hash: hash(content),
				resource_owner_user_id: userId,
				organization_id: orgId,
				created_by: userId,
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')

		// Insert a pending access request for this artifact
		const [req] = await db
			.insert(accessRequests)
			.values({
				organization_id: orgId,
				artifact_id: artifact.id,
				artifact_title_snapshot: artifact.file_name,
				artifact_owner_user_id: userId,
				requester_email: 'requester@example.com',
			})
			.returning()
		if (!req) throw new Error('Failed to create access request')

		// Disable access requests at org level
		await call(
			setOrgSettingsProcedure,
			{ accessRequestsEnabled: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// The pending access request should still be 'pending' — NOT retroactively archived
		const [after] = await db.select().from(accessRequests).where(eq(accessRequests.id, req.id)).limit(1)
		expect(after?.status).toBe('pending')
	})

	test('user can enable subagents when org allows it', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// First enable at org level
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// Now user can enable
		const result = await call(
			updateUserSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.userSettings.experimentalSubagentsEnabled).toBe(true)
		expect(result.orgSettings.experimentalSubagentsEnabled).toBe(true)
		expect(result.effective.experimentalSubagentsEnabled).toBe(true)
	})

	test('effective merge: org=true AND user=false => effective=false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Enable org
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// User keeps subagents off (default)
		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.effective.experimentalSubagentsEnabled).toBe(false)
		expect(result.orgSettings.experimentalSubagentsEnabled).toBe(true)
		expect(result.userSettings.experimentalSubagentsEnabled).toBe(false)
	})

	test('effective merge: org=false AND user=true => effective=false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Enable org first so user can enable
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// Enable user setting
		await call(
			updateUserSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		// Now disable org
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.effective.experimentalSubagentsEnabled).toBe(false)
		expect(result.orgSettings.experimentalSubagentsEnabled).toBe(false)
		expect(result.userSettings.experimentalSubagentsEnabled).toBe(true)
	})

	test('daemon settings GET defaults when no settings exist', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const daemonAuth = makeDaemonAuth(userId, orgId)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		// With no org or user settings, defaults to false
		expect(result.experimentalSubagentsEnabled).toBe(false)
		expect(result.claudeCodeEffectRuntimeEnabled).toBe(false)
	})

	test('daemon settings GET: org=true AND user=false => effective=false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const daemonAuth = makeDaemonAuth(userId, orgId)

		// Enable org setting
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// User has NOT enabled (no user_settings row => defaults to false)
		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		expect(result.experimentalSubagentsEnabled).toBe(false)
	})

	test('daemon settings GET: org=true AND user=true => effective=true', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)
		const daemonAuth = makeDaemonAuth(userId, orgId)

		// Enable org setting
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// Enable user setting
		await call(
			updateUserSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		expect(result.experimentalSubagentsEnabled).toBe(true)
	})

	test('daemon settings GET: org=true, user explicitly disables => effective=false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)
		const daemonAuth = makeDaemonAuth(userId, orgId)

		// Enable org setting
		await call(
			setOrgSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// User enables then disables
		await call(
			updateUserSettingsProcedure,
			{ experimentalSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)
		await call(
			updateUserSettingsProcedure,
			{ experimentalSubagentsEnabled: false },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		expect(result.experimentalSubagentsEnabled).toBe(false)
	})

	// ==================== Haiku Research Subagents Setting ====================

	test('haikuResearchSubagentsEnabled: defaults to false for user, true for org', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: makeUserAuth(userId, orgId),
					services,
				}),
			},
		)

		expect(result.userSettings.haikuResearchSubagentsEnabled).toBe(false)
		// org has no row => ORG_DEFAULTS applies (false for settings-get USER_DEFAULTS/ORG_DEFAULTS)
		expect(result.effective.haikuResearchSubagentsEnabled).toBe(false)
	})

	test('FEATURE_DISABLED_BY_ORG: user cannot enable haiku when org has it disabled', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Explicitly disable at org level
		await call(
			setOrgSettingsProcedure,
			{ haikuResearchSubagentsEnabled: false },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		await expect(
			call(
				updateUserSettingsProcedure,
				{ haikuResearchSubagentsEnabled: true },
				{
					context: createMockApiContext({
						auth: userAuth,
						services,
					}),
				},
			),
		).rejects.toThrow()
	})

	test('user can enable haiku research subagents when org allows it', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Enable at org level
		await call(
			setOrgSettingsProcedure,
			{ haikuResearchSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// User enables the setting
		const result = await call(
			updateUserSettingsProcedure,
			{ haikuResearchSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.userSettings.haikuResearchSubagentsEnabled).toBe(true)
		expect(result.orgSettings.haikuResearchSubagentsEnabled).toBe(true)
		expect(result.effective.haikuResearchSubagentsEnabled).toBe(true)
	})

	test('haiku effective merge: org=true AND user=false => effective=false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Enable org
		await call(
			setOrgSettingsProcedure,
			{ haikuResearchSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// User keeps haiku off (default false)
		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.effective.haikuResearchSubagentsEnabled).toBe(false)
		expect(result.orgSettings.haikuResearchSubagentsEnabled).toBe(true)
		expect(result.userSettings.haikuResearchSubagentsEnabled).toBe(false)
	})

	test('daemon settings GET returns haikuResearchSubagentsEnabled: org=true AND user=true => true', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)
		const daemonAuth = makeDaemonAuth(userId, orgId)

		// Enable org
		await call(
			setOrgSettingsProcedure,
			{ haikuResearchSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// Enable user
		await call(
			updateUserSettingsProcedure,
			{ haikuResearchSubagentsEnabled: true },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		expect(result.haikuResearchSubagentsEnabled).toBe(true)
	})

	test('daemon settings GET returns haikuResearchSubagentsEnabled: defaults to false', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const daemonAuth = makeDaemonAuth(userId, orgId)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{
				context: createMockDaemonContext({
					auth: daemonAuth,
					services,
				}),
			},
		)

		expect(result.haikuResearchSubagentsEnabled).toBe(false)
	})

	// ==================== Advanced Metrics entitlement (auth.user.info) ====================

	// `advancedMetricsAvailable` decides whether the collection toggles render at all, and
	// `advancedMetricsVisible` whether the sidebar link and the dashboard route do. They are the
	// only client-visible form of the two gates, so they are asserted here rather than left to the
	// middleware tests.

	test('user info reports Advanced Metrics available for a Pro org', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const { getUserInfo } = await proceduresOnPlan(orgId, 'price_pro')

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfo,
				{},
				{ context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) },
			)
			expect(result.advancedMetricsAvailable).toBe(true)
			// Collection is a separate decision, and defaults off with no settings row.
			expect(result.commitTrackingEnabled).toBe(false)
			expect(result.prTrackingEnabled).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	// A Starter subscription is in good standing too, so standing alone cannot be the gate.
	test('user info reports Advanced Metrics unavailable for a Starter org', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const { getUserInfo } = await proceduresOnPlan(orgId, 'price_starter')

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfo,
				{},
				{ context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) },
			)
			expect(result.advancedMetricsAvailable).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	test('user info reports Advanced Metrics unavailable for an org with no Stripe customer', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfoProcedure,
				{},
				{ context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) },
			)
			expect(result.advancedMetricsAvailable).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	// Withholding a dashboard is not refusing a write: a KV lookup that failed must not hide the
	// page a paying org bought. See effects/services/billing/entitlements.service.ts.
	test('a billing lookup that fails still reports Advanced Metrics available', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const { getUserInfo } = proceduresOnBillingKv(new DownBillingKvService())

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfo,
				{},
				{ context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) },
			)
			expect(result.advancedMetricsAvailable).toBe(true)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	// ==================== Advanced Metrics audience (auth.user.info) ====================

	test('user info hides Advanced Metrics from a member until the org opens it to everyone', async () => {
		const orgId = await createTestOrg()
		const { getUserInfo, setOrgSettings } = await proceduresOnPlan(orgId, 'price_pro')
		const memberContext = {
			context: createMockApiContext({ auth: makeUserAuth(getUniqueUserId(), orgId), services }),
		}

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const before = await call(getUserInfo, {}, memberContext)
			expect(before.advancedMetricsAvailable).toBe(true)
			expect(before.advancedMetricsVisible).toBe(false)

			await call(
				setOrgSettings,
				{ advancedMetricsVisibleToAllMembers: true },
				{ context: createMockApiContext({ auth: makeAdminAuth(getUniqueUserId(), orgId), services }) },
			)

			const after = await call(getUserInfo, {}, memberContext)
			expect(after.advancedMetricsVisible).toBe(true)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	test('user info shows Advanced Metrics to an admin of an org that never opted in', async () => {
		const orgId = await createTestOrg()
		const { getUserInfo } = await proceduresOnPlan(orgId, 'price_pro')

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfo,
				{},
				{ context: createMockApiContext({ auth: makeAdminAuth(getUniqueUserId(), orgId), services }) },
			)
			expect(result.advancedMetricsVisible).toBe(true)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	// The audience never substitutes for the plan: a stored opt-in from an org that has since
	// dropped to Starter must not put the page back in front of its members.
	test('user info hides Advanced Metrics from an opted-in org that is not entitled', async () => {
		const orgId = await createTestOrg()
		const { getUserInfo, setOrgSettings } = await proceduresOnPlan(orgId, 'price_starter')

		await call(
			setOrgSettings,
			{ advancedMetricsVisibleToAllMembers: true },
			{ context: createMockApiContext({ auth: makeAdminAuth(getUniqueUserId(), orgId), services }) },
		)

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				getUserInfo,
				{},
				{ context: createMockApiContext({ auth: makeUserAuth(getUniqueUserId(), orgId), services }) },
			)
			expect(result.advancedMetricsAvailable).toBe(false)
			expect(result.advancedMetricsVisible).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	test('advancedMetricsVisibleToAllMembers round-trips and survives an unrelated settings write', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminContext = { context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) }

		const defaults = await call(getOrgSettingsProcedure, {}, adminContext)
		expect(defaults.advancedMetricsVisibleToAllMembers).toBe(false)

		const set = await call(setOrgSettingsProcedure, { advancedMetricsVisibleToAllMembers: true }, adminContext)
		expect(set.advancedMetricsVisibleToAllMembers).toBe(true)

		await call(setOrgSettingsProcedure, { slackIntegrationEnabled: true }, adminContext)

		const after = await call(getOrgSettingsProcedure, {}, adminContext)
		expect(after.advancedMetricsVisibleToAllMembers).toBe(true)
		expect(after.slackIntegrationEnabled).toBe(true)
	})

	test('advancedMetricsVisibleToAllMembers is rejected for a Starter org but can always be turned off', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminContext = { context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) }
		const { setOrgSettings } = await proceduresOnPlan(orgId, 'price_starter')

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(
				call(setOrgSettings, { advancedMetricsVisibleToAllMembers: true }, adminContext),
			).rejects.toMatchObject({ code: 'METRICS_BILLING_REQUIRED' })

			// Turning it off is never gated: an org whose plan lapsed must still be able to close
			// the page, and the entitlement check it would face fails open.
			const off = await call(setOrgSettings, { advancedMetricsVisibleToAllMembers: false }, adminContext)
			expect(off.advancedMetricsVisibleToAllMembers).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	// ==================== Advanced Metrics Collection Toggle ====================

	test('collection flags default to false in org settings GET', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		const result = await call(
			getOrgSettingsProcedure,
			{},
			{ context: createMockApiContext({ auth: makeAdminAuth(userId, orgId), services }) },
		)

		expect(result.commitTrackingEnabled).toBe(false)
		expect(result.prTrackingEnabled).toBe(false)
	})

	test('commitTrackingEnabled is rejected for a Starter org', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const { setOrgSettings } = await proceduresOnPlan(orgId, 'price_starter')

		// The suite runs with enforcement off, which entitles every org. Turn it on so the gate is
		// exercised rather than short-circuited.
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(
				call(
					setOrgSettings,
					{ commitTrackingEnabled: true },
					{ context: createMockApiContext({ auth: adminAuth, services }) },
				),
			).rejects.toMatchObject({ code: 'METRICS_BILLING_REQUIRED' })
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}

		// And nothing was written — a rejected toggle must not create a settings row either.
		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.commit_tracking_enabled ?? false).toBe(false)
	})

	test('an org that lost its entitlement can still turn commit tracking OFF', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// Collecting already — enabled while the subscription was in good standing.
		await db.insert(organizationSettings).values({ organization_id: orgId, commit_tracking_enabled: true })

		// Daemons collect on the stored flag alone, so a lost entitlement must not trap the org in
		// telemetry it can no longer withdraw from. No Stripe customer is the strongest form of lost.
		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			const result = await call(
				setOrgSettingsProcedure,
				{ commitTrackingEnabled: false },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			)
			expect(result.commitTrackingEnabled).toBe(false)
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.commit_tracking_enabled).toBe(false)
	})

	test('an entitled org can turn commit tracking on and off; turning it off takes PR tracking with it', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		const setOn = await call(
			setOrgSettingsProcedure,
			{ commitTrackingEnabled: true },
			{ context: createMockApiContext({ auth: adminAuth, services }) },
		)
		expect(setOn.commitTrackingEnabled).toBe(true)
		expect(setOn.prTrackingEnabled).toBe(true)

		const setOff = await call(
			setOrgSettingsProcedure,
			{ commitTrackingEnabled: false },
			{ context: createMockApiContext({ auth: adminAuth, services }) },
		)
		expect(setOff.commitTrackingEnabled).toBe(false)
		expect(setOff.prTrackingEnabled).toBe(false)

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.commit_tracking_enabled).toBe(false)
		expect(row?.pr_tracking_enabled).toBe(false)
	})

	test('prTrackingEnabled is rejected for a Starter org', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const { setOrgSettings } = await proceduresOnPlan(orgId, 'price_starter')

		process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'true'
		try {
			await expect(
				call(
					setOrgSettings,
					{ prTrackingEnabled: true },
					{ context: createMockApiContext({ auth: adminAuth, services }) },
				),
			).rejects.toMatchObject({ code: 'METRICS_BILLING_REQUIRED' })
		} finally {
			process.env.IS_BILLING_ENFORCEMENT_ENABLED = 'false'
		}
	})

	test('prTrackingEnabled is rejected without a GitHub App installation that reaches a repository', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		await expect(
			call(
				setOrgSettingsProcedure,
				{ prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_REQUIRED' })

		// An installation with no repositories is not enough: there is nothing to read from.
		const [emptyInstallation] = await db
			.insert(githubIntegrations)
			.values({
				organization_id: orgId,
				installation_id: `install-empty-${orgId}`,
				account_id: '4242',
				account_login: 'acme',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: { metadata: 'read', pull_requests: 'read', checks: 'read', statuses: 'read' },
				installation_status: 'active',
				connected_by_user_id: userId,
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning({ id: githubIntegrations.id })
		await expect(
			call(
				setOrgSettingsProcedure,
				{ prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_REQUIRED' })

		// An archived repository cannot receive pushes, so it does not count as coverage either.
		await db.insert(githubIntegrationRepositories).values({
			integration_id: emptyInstallation!.id,
			github_repository_id: `repo-archived-${orgId}`,
			owner_login: 'acme',
			repository_name: 'attic',
			full_name: 'acme/attic',
			private: true,
			default_branch: 'main',
			archived: true,
		})
		await expect(
			call(
				setOrgSettingsProcedure,
				{ prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_REQUIRED' })

		// A live repository on a suspended installation is unreachable until GitHub restores it.
		await db.insert(githubIntegrationRepositories).values({
			integration_id: emptyInstallation!.id,
			github_repository_id: `repo-live-${orgId}`,
			owner_login: 'acme',
			repository_name: 'repo',
			full_name: 'acme/repo',
			private: true,
			default_branch: 'main',
		})
		await db
			.update(githubIntegrations)
			.set({ installation_status: 'suspended' })
			.where(eq(githubIntegrations.id, emptyInstallation!.id))
		await expect(
			call(
				setOrgSettingsProcedure,
				{ prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'GITHUB_INSTALLATION_REQUIRED' })

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.pr_tracking_enabled ?? false).toBe(false)

		// Turning it off never needs an installation.
		await db
			.update(organizationSettings)
			.set({ pr_tracking_enabled: true })
			.where(eq(organizationSettings.organization_id, orgId))
		await db.delete(githubIntegrations).where(eq(githubIntegrations.id, emptyInstallation!.id))
		const setOff = await call(
			setOrgSettingsProcedure,
			{ prTrackingEnabled: false },
			{ context: createMockApiContext({ auth: adminAuth, services }) },
		)
		expect(setOff.prTrackingEnabled).toBe(false)
	})

	test('an entitled org with a covered repository can turn pr tracking on once commit tracking is on', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		const [installation] = await db
			.insert(githubIntegrations)
			.values({
				organization_id: orgId,
				installation_id: `install-covered-${orgId}`,
				account_id: '4242',
				account_login: 'acme',
				account_type: 'Organization',
				repository_selection: 'selected',
				permissions: { metadata: 'read', pull_requests: 'read', checks: 'read', statuses: 'read' },
				installation_status: 'active',
				connected_by_user_id: userId,
				last_reconciled_at: BigInt(Date.now()),
			})
			.returning({ id: githubIntegrations.id })
		await db.insert(githubIntegrationRepositories).values({
			integration_id: installation!.id,
			github_repository_id: `repo-${orgId}`,
			owner_login: 'acme',
			repository_name: 'repo',
			full_name: 'acme/repo',
			private: true,
			default_branch: 'main',
		})

		// Without commit tracking there is nothing to credit a pull request through.
		await expect(
			call(
				setOrgSettingsProcedure,
				{ prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'COMMIT_TRACKING_REQUIRED' })
		await expect(
			call(
				setOrgSettingsProcedure,
				{ commitTrackingEnabled: false, prTrackingEnabled: true },
				{ context: createMockApiContext({ auth: adminAuth, services }) },
			),
		).rejects.toMatchObject({ code: 'COMMIT_TRACKING_REQUIRED' })

		// Both in one write, or commit tracking already on, is enough.
		const setOn = await call(
			setOrgSettingsProcedure,
			{ commitTrackingEnabled: true, prTrackingEnabled: true },
			{ context: createMockApiContext({ auth: adminAuth, services }) },
		)
		expect(setOn.prTrackingEnabled).toBe(true)
		expect(setOn.commitTrackingEnabled).toBe(true)

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.pr_tracking_enabled).toBe(true)
		expect(row?.commit_tracking_enabled).toBe(true)
	})

	test('other org settings writes do not disturb the collection flags', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		const result = await call(
			setOrgSettingsProcedure,
			{ accessRequestsEnabled: false },
			{ context: createMockApiContext({ auth: adminAuth, services }) },
		)
		expect(result.commitTrackingEnabled).toBe(true)
		expect(result.prTrackingEnabled).toBe(true)

		const [row] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, orgId))
			.limit(1)
		expect(row?.commit_tracking_enabled).toBe(true)
		expect(row?.pr_tracking_enabled).toBe(true)
	})

	// ==================== Per-User Git Tracking (Advanced Metrics opt-in) ====================

	// The row-absent case is the one that governs a fresh member: no user_settings row is written
	// until they change a setting, so the column default never runs for them and USER_DEFAULTS
	// decides. It read false before this and made the org opt-in collect nothing.
	test('daemon settings: org collection on and the member has no settings row => collection is on', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)

		expect(result.commitTrackingEnabled).toBe(true)
		expect(result.prTrackingEnabled).toBe(true)
	})

	test('daemon settings: org collection on but the member is excluded => collection stays off', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})
		await db.insert(userSettings).values({
			user_id: userId,
			organization_id: orgId,
			metrics_advanced_enabled: false,
		})

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)

		expect(result.commitTrackingEnabled).toBe(false)
		// Pull request tracking is org-wide: the member exclusion does not apply.
		expect(result.prTrackingEnabled).toBe(true)
	})

	test('a settings row created by an ordinary user-facing update collects by default', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		// The user-facing upsert does not mention metrics_advanced_enabled, so the row it inserts
		// takes the column default — which is the half of default-on that lives in the schema.
		await call(
			updateUserSettingsProcedure,
			{ theme: 'monokai' },
			{ context: createMockApiContext({ auth: makeUserAuth(userId, orgId), services }) },
		)

		const [row] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, orgId)))
		expect(row?.metrics_advanced_enabled).toBe(true)

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)
		expect(result.commitTrackingEnabled).toBe(true)
	})

	test('setMetricsAdvancedEnabled opts a member in; daemon collection follows org && user', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		const workosStateful = new StatefulMockWorkosService()
		workosStateful.addMembership({
			userId,
			organizationId: adminAuth.workosOrganizationId,
			role: { slug: 'member' },
		})
		const statefulServices = { ...services, workos: workosStateful }

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		const setResult = await call(
			setAdminUserMetricsAdvancedProcedure,
			{ userId, enabled: true },
			{ context: createMockApiContext({ auth: adminAuth, services: statefulServices }) },
		)
		expect(setResult).toEqual({ userId, metricsAdvancedEnabled: true })

		const daemonOn = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)
		expect(daemonOn.commitTrackingEnabled).toBe(true)
		expect(daemonOn.prTrackingEnabled).toBe(true)

		// Opting back out stops collection again
		await call(
			setAdminUserMetricsAdvancedProcedure,
			{ userId, enabled: false },
			{ context: createMockApiContext({ auth: adminAuth, services: statefulServices }) },
		)
		const daemonOff = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)
		expect(daemonOff.commitTrackingEnabled).toBe(false)
		// Pull request tracking is org-wide: the member exclusion does not apply.
		expect(daemonOff.prTrackingEnabled).toBe(true)
	})

	// The org gate is the sole thing under test here: with the member term now defaulting true,
	// there is no per-user opt-in left to set up, so a member who has made no choice is the
	// interesting case — the org flag alone has to hold the line.
	test('org collection off => collection stays off however the member stands', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()

		const result = await call(
			daemonGetSettingsProcedure,
			{},
			{ context: createMockDaemonContext({ auth: makeDaemonAuth(userId, orgId), services }) },
		)
		expect(result.commitTrackingEnabled).toBe(false)
		expect(result.prTrackingEnabled).toBe(false)
	})

	// The riptide-ui terminal launcher arms the trailer stamper off auth.user.settings.get's
	// orgSettings.commitTrackingEnabled — it injects HUMANLAYER_COMMIT_TRACKING and the
	// GIT_CONFIG_* hooks path into the PTY. If that value were the raw org flag, an excluded
	// member would still get HumanLayer-Session trailers written into their commit messages,
	// contradicting the exclusion the settings copy promises.
	test('user settings GET reports collection off for an excluded member', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const userAuth = makeUserAuth(userId, orgId)

		await db.insert(organizationSettings).values({
			organization_id: orgId,
			commit_tracking_enabled: true,
			pr_tracking_enabled: true,
		})

		// No settings row yet: the member has made no choice, so collection is on.
		const beforeExclusion = await call(
			getUserSettingsProcedure,
			{},
			{ context: createMockApiContext({ auth: userAuth, services }) },
		)
		expect(beforeExclusion.orgSettings.commitTrackingEnabled).toBe(true)

		await db.insert(userSettings).values({
			user_id: userId,
			organization_id: orgId,
			metrics_advanced_enabled: false,
		})

		const afterExclusion = await call(
			getUserSettingsProcedure,
			{},
			{ context: createMockApiContext({ auth: userAuth, services }) },
		)
		expect(afterExclusion.orgSettings.commitTrackingEnabled).toBe(false)

		// The user-facing UPDATE returns the same effective value — the launcher reads whichever
		// response it holds, so the two must not disagree.
		const afterUpdate = await call(
			updateUserSettingsProcedure,
			{ theme: 'monokai' },
			{ context: createMockApiContext({ auth: userAuth, services }) },
		)
		expect(afterUpdate.orgSettings.commitTrackingEnabled).toBe(false)
	})

	test('setMetricsAdvancedEnabled rejects users outside the organization', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// Stateful mock with NO membership seeded for the target user
		const workosStateful = new StatefulMockWorkosService()

		await expect(
			call(
				setAdminUserMetricsAdvancedProcedure,
				{ userId: 'user_not_in_org', enabled: true },
				{
					context: createMockApiContext({
						auth: adminAuth,
						services: { ...services, workos: workosStateful },
					}),
				},
			),
		).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
	})

	test('user-facing settings updates do not clobber the admin-owned advanced metrics flag', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		const workosStateful = new StatefulMockWorkosService()
		workosStateful.addMembership({
			userId,
			organizationId: adminAuth.workosOrganizationId,
			role: { slug: 'member' },
		})

		// Exclude the member. `false` is the direction that can actually be clobbered now that the
		// column defaults true — asserting an admin-set `true` survives would pass on the default
		// alone.
		await call(
			setAdminUserMetricsAdvancedProcedure,
			{ userId, enabled: false },
			{ context: createMockApiContext({ auth: adminAuth, services: { ...services, workos: workosStateful } }) },
		)

		// The user updates their own settings; the flag is not part of the user contract
		await call(
			updateUserSettingsProcedure,
			{ theme: 'dracula' },
			{ context: createMockApiContext({ auth: userAuth, services }) },
		)

		const [row] = await db
			.select()
			.from(userSettings)
			.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, orgId)))
			.limit(1)
		expect(row?.metrics_advanced_enabled).toBe(false)
		expect(row?.theme).toBe('dracula')
	})

	// ==================== V2 Compatibility Fields ====================

	test('admin org settings compatibility fields report v2', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		const result = await call(
			getOrgSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		expect(result.syncVisibility).toBe('v2')
		expect(result.syncVersion).toBe(2)
		expect('v1Backend' in result).toBe(false)
	})

	test('admin org settings ignores legacy v1 inputs', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		const result = await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v1' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		expect(result.syncVisibility).toBe('v2')
		expect('v1Backend' in result).toBe(false)
		expect(result.syncVersion).toBe(2)
	})

	test('admin org settings always returns v2 across legacy updates', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)

		// First set to v1
		await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v1' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		// Then set to v2
		const result = await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v2' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		expect(result.syncVisibility).toBe('v2')
		expect('v1Backend' in result).toBe(false)
		expect(result.syncVersion).toBe(2)
	})

	test('user settings GET returns v2 after a legacy v1 admin input', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Set org to v1
		await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v1' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		const result = await call(
			getUserSettingsProcedure,
			{},
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.orgSettings.syncVisibility).toBe('v2')
		expect(result.orgSettings.syncVersion).toBe(2)
		expect('v1Backend' in result.orgSettings).toBe(false)
	})

	test('sync v2 endpoints are allowed without stored policy', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const userAuth = makeUserAuth(userId, orgId)

		const result = await call(
			syncV2SessionsProcedure,
			{ limit: 10 },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.rows).toEqual([])
	})

	test('sync v2 endpoints remain allowed after a legacy v2 input', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Set org to v2
		await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v2' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		const result = await call(
			syncV2SessionsProcedure,
			{ limit: 10 },
			{
				context: createMockApiContext({
					auth: userAuth,
					services,
				}),
			},
		)

		expect(result.rows).toEqual([])
	})

	test('sync v2 endpoints remain allowed after a legacy v1 input', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Set org to v1
		await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v1' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		const result = await call(
			syncV2SessionsProcedure,
			{ limit: 10 },
			{
				context: createMockApiContext({ auth: userAuth, services }),
			},
		)

		expect(result.rows).toEqual([])
	})

	test('legacy v1 inputs do not affect subsequent user settings updates', async () => {
		const userId = getUniqueUserId()
		const orgId = await createTestOrg()
		const adminAuth = makeAdminAuth(userId, orgId)
		const userAuth = makeUserAuth(userId, orgId)

		// Set org to v1
		await call(
			setOrgSettingsProcedure,
			{ syncVisibility: 'v1' },
			{
				context: createMockApiContext({
					auth: adminAuth,
					services,
				}),
			},
		)

		const result = await call(
			updateUserSettingsProcedure,
			{ theme: 'dracula' },
			{
				context: createMockApiContext({ auth: userAuth, services }),
			},
		)

		expect(result.orgSettings.syncVersion).toBe(2)
		expect(result.orgSettings.syncVisibility).toBe('v2')
	})
})
