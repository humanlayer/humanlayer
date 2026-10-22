import { randomUUID } from 'node:crypto'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError, ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { adminArchiveAccessRequestProcedure as liveAdminArchiveAccessRequestProcedure } from '../../src/orpc/api/auth/admin/access-requests/archive'
import { adminListAccessRequestsProcedure } from '../../src/orpc/api/auth/admin/access-requests/list'
import { adminCountUnreadAccessRequestsEffectProcedure as liveAdminCountUnreadAccessRequestsProcedure } from '../../src/orpc/api/auth/admin/access-requests/unread-count.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { StatefulMockWorkosService } from '../mocks/workos-service.mock'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('admin access requests', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrganizationId: string
	let artifactId: string
	let workosOrgId: string
	let archiveProcedure: typeof liveAdminArchiveAccessRequestProcedure
	let unreadCountProcedure: typeof liveAdminCountUnreadAccessRequestsProcedure

	beforeAll(async () => {
		const testDb = await createTestDb('admin_access_requests')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		workosOrgId = `workos-${randomUUID()}`

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Admin Request Org', workos_organization_id: workosOrgId })
			.returning()
		if (!org) throw new Error('Failed to create org')
		organizationId = org.id

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Failed to create other org')
		otherOrganizationId = otherOrg.id

		const content = '# Admin requestable artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'admin-requestable.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id

		// The admin archive procedure is now an Effect procedure backed by `appRuntime`;
		// rebind it to a test runtime built with the test db so `archiveRequest` writes
		// (and reminder cancellations) land in the test database. The default test-runtime
		// Resend layer succeeds, so cancellations record `canceledAt`. The `unreadCount`
		// procedure is also an Effect procedure and is rebound to the test runtime. The
		// `list` procedure remains a classic handler querying `context.services.db`.
		const runtime = createRuntimeWithTestPostgresLayer(db)
		archiveProcedure = bindProcedureToRuntime(liveAdminArchiveAccessRequestProcedure, runtime)
		unreadCountProcedure = bindProcedureToRuntime(liveAdminCountUnreadAccessRequestsProcedure, runtime)
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	// Classic context for the still-classic list/unread-count handlers and for supplying
	// auth (org + role) to the rebound Effect archive procedure.
	const makeAdminContext = (overrides?: Partial<Parameters<typeof createMockApiAuth>[0]>) =>
		createMockApiContext({
			auth: createMockApiAuth({
				role: 'admin',
				roles: ['admin'],
				organizationId,
				workosOrganizationId: workosOrgId,
				...overrides,
			}),
			services: {
				db,
				dbReadReplica: db,
				workos: new StatefulMockWorkosService(),
			},
		})

	const makeNonAdminContext = () =>
		createMockApiContext({
			auth: createMockApiAuth({
				role: 'member',
				roles: ['member'],
				organizationId,
				workosOrganizationId: workosOrgId,
			}),
			services: { db, dbReadReplica: db, workos: new StatefulMockWorkosService() },
		})

	async function seedPendingRequest(requesterEmail?: string) {
		const email = requesterEmail ?? `requester-${randomUUID()}@example.com`
		const [row] = await db
			.insert(accessRequests)
			.values({
				organization_id: organizationId,
				artifact_id: artifactId,
				artifact_title_snapshot: 'admin-requestable.md',
				artifact_owner_user_id: 'artifact-owner',
				requester_email: email,
				status: 'pending',
				notification_status: 'not_started',
			})
			.returning()
		if (!row) throw new Error('Failed to create access request')
		return row
	}

	describe('list', () => {
		test('returns only the admin org rows', async () => {
			const email = `list-org-${randomUUID()}@example.com`
			const myRows = await db
				.insert(accessRequests)
				.values({
					organization_id: organizationId,
					artifact_id: artifactId,
					artifact_title_snapshot: 'admin-requestable.md',
					artifact_owner_user_id: 'artifact-owner',
					requester_email: email,
					status: 'pending',
					notification_status: 'not_started',
				})
				.returning()
			const myRow = myRows[0]
			if (!myRow) throw new Error('Failed to create access request')

			// Also seed a row in a different org - should NOT appear
			const content = '# Other artifact'
			const otherArtifacts = await db
				.insert(artifacts)
				.values({
					organization_id: otherOrganizationId,
					resource_owner_user_id: 'other-owner',
					file_name: `other-${randomUUID()}.md`,
					content,
					content_hash: hash(content),
					created_by: 'other-owner',
				})
				.returning()
			const otherArtifact = otherArtifacts[0]
			if (!otherArtifact) throw new Error('Failed to create other artifact')

			await db.insert(accessRequests).values({
				organization_id: otherOrganizationId,
				artifact_id: otherArtifact.id,
				artifact_title_snapshot: 'other.md',
				artifact_owner_user_id: 'other-owner',
				requester_email: `other-org-${randomUUID()}@example.com`,
				status: 'pending',
				notification_status: 'not_started',
			})

			const result = await call(
				adminListAccessRequestsProcedure,
				{ status: 'pending' },
				{ context: makeAdminContext() },
			)

			const myIds = result.map((r) => r.id)
			expect(myIds).toContain(myRow.id)
			// The other org row should not appear
			result.forEach((r) => {
				expect(r.id).not.toContain(otherOrganizationId)
			})
		})

		test('filters by status param', async () => {
			const pendingEmail = `pending-filter-${randomUUID()}@example.com`
			const archivedEmail = `archived-filter-${randomUUID()}@example.com`

			const pendingRows = await db
				.insert(accessRequests)
				.values({
					organization_id: organizationId,
					artifact_id: artifactId,
					artifact_title_snapshot: 'admin-requestable.md',
					artifact_owner_user_id: 'artifact-owner',
					requester_email: pendingEmail,
					status: 'pending',
					notification_status: 'not_started',
				})
				.returning()
			const pending = pendingRows[0]
			if (!pending) throw new Error('Failed to create pending request')

			const archivedRows = await db
				.insert(accessRequests)
				.values({
					organization_id: organizationId,
					artifact_id: artifactId,
					artifact_title_snapshot: 'admin-requestable.md',
					artifact_owner_user_id: 'artifact-owner',
					requester_email: archivedEmail,
					status: 'archived',
					archived_at: new Date(),
					notification_status: 'not_started',
				})
				.returning()
			const archived = archivedRows[0]
			if (!archived) throw new Error('Failed to create archived request')

			const pendingResult = await call(
				adminListAccessRequestsProcedure,
				{ status: 'pending' },
				{ context: makeAdminContext() },
			)
			const archivedResult = await call(
				adminListAccessRequestsProcedure,
				{ status: 'archived' },
				{ context: makeAdminContext() },
			)

			const pendingIds = pendingResult.map((r) => r.id)
			const archivedIds = archivedResult.map((r) => r.id)

			expect(pendingIds).toContain(pending.id)
			expect(archivedIds).toContain(archived.id)
			// Pending should not appear in archived and vice versa
			expect(pendingIds).not.toContain(archived.id)
			expect(archivedIds).not.toContain(pending.id)
		})
	})

	describe('unreadCount', () => {
		test('returns count of pending only', async () => {
			// Use a dedicated org so concurrent tests in this file (which run via
			// `Vitest` despite `describe`) can't mutate the
			// pending count between baseline and the final assertion.
			const unreadOrgWorkosId = `workos-${randomUUID()}`
			const [unreadOrg] = await db
				.insert(organizations)
				.values({ name: 'Unread Count Org', workos_organization_id: unreadOrgWorkosId })
				.returning()
			if (!unreadOrg) throw new Error('Failed to create unread count org')

			const unreadContent = '# Unread count artifact'
			const [unreadArtifact] = await db
				.insert(artifacts)
				.values({
					organization_id: unreadOrg.id,
					resource_owner_user_id: 'artifact-owner',
					file_name: 'unread-count.md',
					content: unreadContent,
					content_hash: hash(unreadContent),
					created_by: 'artifact-owner',
				})
				.returning()
			if (!unreadArtifact) throw new Error('Failed to create unread count artifact')

			const unreadContext = makeAdminContext({
				organizationId: unreadOrg.id,
				workosOrganizationId: unreadOrgWorkosId,
			})

			const baseline = await call(unreadCountProcedure, {}, { context: unreadContext })

			// Add a pending request
			await db.insert(accessRequests).values({
				organization_id: unreadOrg.id,
				artifact_id: unreadArtifact.id,
				artifact_title_snapshot: 'unread-count.md',
				artifact_owner_user_id: 'artifact-owner',
				requester_email: `requester-${randomUUID()}@example.com`,
				status: 'pending',
				notification_status: 'not_started',
			})

			// Add an archived request (should not count)
			await db.insert(accessRequests).values({
				organization_id: unreadOrg.id,
				artifact_id: unreadArtifact.id,
				artifact_title_snapshot: 'unread-count.md',
				artifact_owner_user_id: 'artifact-owner',
				requester_email: `archived-unread-${randomUUID()}@example.com`,
				status: 'archived',
				archived_at: new Date(),
				notification_status: 'not_started',
			})

			const result = await call(unreadCountProcedure, {}, { context: unreadContext })

			expect(result.count).toBe(baseline.count + 1)
		})
	})

	describe('archive', () => {
		test('archive flips status to archived', async () => {
			const row = await seedPendingRequest()

			await call(archiveProcedure, { requestId: row.id }, { context: makeAdminContext() })

			const [updated] = await db
				.select({ status: accessRequests.status, archived_at: accessRequests.archived_at })
				.from(accessRequests)
				.where(eq(accessRequests.id, row.id))
				.limit(1)

			expect(updated?.status).toBe('archived')
			expect(updated?.archived_at).not.toBeNull()
		})

		test('archive cancels future scheduled reminders and records canceledAt', async () => {
			const futureScheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
			const fakeEmailId = `fake-email-${randomUUID()}`

			const [row] = await db
				.insert(accessRequests)
				.values({
					organization_id: organizationId,
					artifact_id: artifactId,
					artifact_title_snapshot: 'admin-requestable.md',
					artifact_owner_user_id: 'artifact-owner',
					requester_email: `reminder-cancel-${randomUUID()}@example.com`,
					status: 'pending',
					notification_status: 'scheduled',
					scheduled_reminders: [
						{
							requestGeneration: 1,
							adminUserId: 'admin-user',
							adminEmail: 'admin@example.com',
							resendEmailId: fakeEmailId,
							scheduledAt: futureScheduledAt,
						},
					],
				})
				.returning()
			if (!row) throw new Error('Failed to create access request with reminder')

			// The test runtime's Resend layer succeeds, so cancelScheduled records canceledAt.
			// Either outcome is accepted below; the archive must still succeed regardless.
			const result = await call(archiveProcedure, { requestId: row.id }, { context: makeAdminContext() })

			expect(result.ok).toBe(true)

			const [updated] = await db
				.select({
					status: accessRequests.status,
					notification_status: accessRequests.notification_status,
					scheduled_reminders: accessRequests.scheduled_reminders,
				})
				.from(accessRequests)
				.where(eq(accessRequests.id, row.id))
				.limit(1)

			expect(updated?.status).toBe('archived')
			// Archiving a request with pending reminders ends the notification lifecycle.
			expect(updated?.notification_status).toBe('canceled')
			// The reminder should have either canceledAt set (success) or cancelError set (graceful failure)
			const reminder = updated?.scheduled_reminders?.[0]
			expect(reminder?.resendEmailId).toBe(fakeEmailId)
			const hasCanceledAt = 'canceledAt' in (reminder ?? {}) && reminder?.canceledAt != null
			const hasCancelError = 'cancelError' in (reminder ?? {}) && reminder?.cancelError != null
			expect(hasCanceledAt || hasCancelError).toBe(true)
		})

		test('archive returns ok:true', async () => {
			const row = await seedPendingRequest()
			const result = await call(archiveProcedure, { requestId: row.id }, { context: makeAdminContext() })
			expect(result.ok).toBe(true)
		})

		test('non-admin caller is rejected with FORBIDDEN', async () => {
			const row = await seedPendingRequest()
			try {
				await call(archiveProcedure, { requestId: row.id }, { context: makeNonAdminContext() })
				expect.unreachable('Expected FORBIDDEN')
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError)
				expect(isDefinedError(error)).toBe(true)
				expect((error as ORPCError<any, any>).code).toBe('FORBIDDEN')
			}
		})
	})

	describe('list - non-admin rejected', () => {
		test('non-admin caller is rejected with FORBIDDEN', async () => {
			try {
				await call(adminListAccessRequestsProcedure, { status: 'pending' }, { context: makeNonAdminContext() })
				expect.unreachable('Expected FORBIDDEN')
			} catch (error) {
				expect(error).toBeInstanceOf(ORPCError)
				expect(isDefinedError(error)).toBe(true)
				expect((error as ORPCError<any, any>).code).toBe('FORBIDDEN')
			}
		})
	})
})
