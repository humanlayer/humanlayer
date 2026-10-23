import { randomUUID } from 'node:crypto'

import { describe, it } from '@effect/vitest'
import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Clock, DateTime, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { hash } from 'ohash'
import { afterAll, beforeAll } from 'vitest'

import {
	initialIdempotencyKey,
	reminderIdempotencyKey,
} from '../../src/effects/services/access-request/access-request-emails'
import {
	AccessRequestService,
	AccessRequestServiceLive,
} from '../../src/effects/services/access-request/access-request.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { ResendOperationError } from '../../src/effects/services/resend/resend-errors'
import { ResendService } from '../../src/effects/services/resend/resend.service'
import { WorkosServerError } from '../../src/effects/services/workos/workos.errors'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { ResendConfigTest } from '../fixtures/resend-config-test-layer'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

// ---------------------------------------------------------------------------
// Fake WorkOS layer helpers
// ---------------------------------------------------------------------------

type FakeAdmin = { userId: string; email: string; firstName?: string | null }

function withFirstName(admins: FakeAdmin[]): Array<{ userId: string; email: string; firstName: string | null }> {
	return admins.map((a) => ({ userId: a.userId, email: a.email, firstName: a.firstName ?? null }))
}

function makeFakeWorkosLayer(admins: FakeAdmin[] | Error) {
	return Layer.succeed(WorkosService, {
		...makeTestWorkosService(),
		listActiveAdmins: () =>
			admins instanceof Error
				? Effect.fail(new WorkosServerError({ cause: admins }))
				: Effect.succeed(withFirstName(admins)),
		sendInvitation: () => Effect.fail(new WorkosServerError({ cause: new Error('not implemented') })),
		getUser: ({ userId }) =>
			Effect.succeed({ userId, email: `${userId}@example.com`, firstName: null, lastName: null }),
		hasPendingInvitation: () => Effect.succeed(false),
		countActiveOrganizationMemberships: () => Effect.succeed(0),
		countPendingInvitations: () => Effect.succeed(0),
		listUsersByEmail: () => Effect.succeed([]),
		listActiveOrganizationMemberships: () => Effect.succeed([]),
	})
}

// ---------------------------------------------------------------------------
// Fake Resend layer helpers
// ---------------------------------------------------------------------------

type SentEmail = {
	type: 'immediate' | 'scheduled'
	to: string
	subject: string
	text: string
	idempotencyKey: string
	scheduledAt?: string
}

class FakeResendStore {
	sent: SentEmail[] = []
	canceled: string[] = []
	emailCounter = 0

	nextId() {
		return `resend-email-${++this.emailCounter}`
	}

	reset() {
		this.sent = []
		this.canceled = []
		this.emailCounter = 0
	}
}

const resendOperationError = (retryable: boolean) =>
	new ResendOperationError({
		operation: 'test',
		category: retryable ? 'rate_limited' : 'invalid_request',
		retryable,
	})

function makeFakeResendLayer(
	store: FakeResendStore,
	opts: { failOnSend?: boolean; failOnSchedule?: boolean; rateLimitOnSend?: boolean } = {},
) {
	return Layer.succeed(ResendService, {
		sendPlaintext: (input) => {
			if (opts.rateLimitOnSend) {
				return Effect.fail(resendOperationError(true))
			}
			if (opts.failOnSend) {
				return Effect.fail(resendOperationError(false))
			}
			const emailId = store.nextId()
			store.sent.push({ type: 'immediate', ...input })
			return Effect.succeed({ emailId })
		},

		schedulePlaintext: (input) => {
			if (opts.failOnSchedule) {
				return Effect.fail(resendOperationError(false))
			}
			const emailId = store.nextId()
			store.sent.push({
				type: 'scheduled',
				to: input.to,
				subject: input.subject,
				text: input.text,
				idempotencyKey: input.idempotencyKey,
				scheduledAt: input.scheduledAt.toISOString(),
			})
			return Effect.succeed({ emailId, scheduledAt: input.scheduledAt.toISOString() })
		},

		cancelScheduled: (input) => {
			store.canceled.push(input.emailId)
			return Effect.succeed(undefined)
		},
		getContact: () => Effect.succeed(null),
		upsertContact: () => Effect.succeed({ contactId: 'contact-test' }),
		patchContactProperties: () => Effect.succeed({ contactId: 'contact-test' }),
		sendEvent: () => Effect.void,
	})
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('AccessRequestService.createAccessRequest', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('access_request_service_effect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const workosOrgId = `workos-org-${randomUUID()}`
		const [org] = await db
			.insert(organizations)
			.values({ name: 'Test Org For Effect Service', workos_organization_id: workosOrgId })
			.returning()
		if (!org) throw new Error('Failed to create org')

		const content = '# Test artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: org.id,
				resource_owner_user_id: 'owner-user',
				file_name: 'test-artifact.md',
				content,
				content_hash: hash(content),
				created_by: 'owner-user',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeLayer(
		admins: FakeAdmin[] | Error,
		resendStore: FakeResendStore,
		resendOpts: Parameters<typeof makeFakeResendLayer>[1] = {},
	) {
		return Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(
				PostgresDbLive(db),
				makeFakeWorkosLayer(admins),
				makeFakeResendLayer(resendStore, resendOpts),
				ResendConfigTest(),
			),
		)
	}

	it.effect('skips admin notification when requester already has a pending invitation', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = [
			{ userId: 'admin-1', email: 'admin1@example.com' },
			{ userId: 'admin-2', email: 'admin2@example.com' },
		]
		// WorkOS reports a pending invitation already exists for this requester.
		const workosLayer = Layer.succeed(WorkosService, {
			...makeTestWorkosService(),
			listActiveAdmins: () => Effect.succeed(withFirstName(admins)),
			sendInvitation: () => Effect.fail(new WorkosServerError({ cause: new Error('not implemented') })),
			getUser: ({ userId }) =>
				Effect.succeed({ userId, email: `${userId}@example.com`, firstName: null, lastName: null }),
			hasPendingInvitation: () => Effect.succeed(true),
			countActiveOrganizationMemberships: () => Effect.succeed(0),
			countPendingInvitations: () => Effect.succeed(1),
			listUsersByEmail: () => Effect.succeed([]),
			listActiveOrganizationMemberships: () => Effect.succeed([]),
		})
		const layer = Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(PostgresDbLive(db), workosLayer, makeFakeResendLayer(store), ResendConfigTest()),
		)
		const requesterEmail = `requester-already-invited-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: 'requester-already-invited',
			})

			expect(result.accessRequestId).toBeDefined()
			expect(result.alreadyInvited).toBe(true)

			// No admin emails should have been sent or scheduled.
			expect(store.sent).toHaveLength(0)

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)
			expect(row?.notification_status).toBe('not_started')
			expect(row?.initial_email_attempts).toHaveLength(0)
			expect(row?.scheduled_reminders).toHaveLength(0)
		}).pipe(Effect.provide(layer))
	})

	it.effect('sends one initial + one scheduled email per admin', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = [
			{ userId: 'admin-1', email: 'admin1@example.com' },
			{ userId: 'admin-2', email: 'admin2@example.com' },
		]
		const layer = makeLayer(admins, store)
		const requesterEmail = `requester-two-admins-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: 'requester-user-1',
			})

			expect(result.accessRequestId).toBeDefined()

			// 2 admins × (1 immediate + 1 scheduled) = 4 sent
			expect(store.sent).toHaveLength(4)
			const immediateEmails = store.sent.filter((e) => e.type === 'immediate')
			const scheduledEmails = store.sent.filter((e) => e.type === 'scheduled')
			expect(immediateEmails).toHaveLength(2)
			expect(scheduledEmails).toHaveLength(2)

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			expect(row?.notification_status).toBe('scheduled')
			expect(row?.initial_email_attempts).toHaveLength(2)
			expect(row?.scheduled_reminders).toHaveLength(2)
		}).pipe(Effect.provide(layer))
	})

	it.effect('records idempotency keys stable across request_generation', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = [{ userId: 'admin-idem', email: 'admin-idem@example.com' }]
		const layer = makeLayer(admins, store)
		const requesterEmail = `requester-idempotency-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService

			// First request
			const r1 = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: 'requester-idem',
			})

			const [row1] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, r1.accessRequestId)).limit(1),
			)

			const expectedInitialKey1 = initialIdempotencyKey({
				accessRequestId: r1.accessRequestId,
				requestGeneration: 1,
				adminUserId: 'admin-idem',
			})
			const expectedReminderKey1 = reminderIdempotencyKey({
				accessRequestId: r1.accessRequestId,
				requestGeneration: 1,
				adminUserId: 'admin-idem',
			})

			// Verify keys have correct format
			expect(expectedInitialKey1).toMatch(/^access-request-initial\//)
			expect(expectedReminderKey1).toMatch(/^access-request-reminder\//)
			expect(row1?.request_generation).toBe(1)

			// Archive and re-request
			const archivedAt = yield* DateTime.nowAsDate
			yield* Effect.promise(() =>
				db
					.update(accessRequests)
					.set({ status: 'archived', archived_at: archivedAt })
					.where(eq(accessRequests.id, r1.accessRequestId)),
			)

			store.reset()

			// Re-request creates generation 2
			const r2 = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: 'requester-idem',
			})

			expect(r2.accessRequestId).toBe(r1.accessRequestId)

			const [row2] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, r2.accessRequestId)).limit(1),
			)
			expect(row2?.request_generation).toBe(2)

			// Generation 2 idempotency key should differ from generation 1
			const expectedInitialKey2 = initialIdempotencyKey({
				accessRequestId: r2.accessRequestId,
				requestGeneration: 2,
				adminUserId: 'admin-idem',
			})
			expect(expectedInitialKey2).not.toBe(expectedInitialKey1)
			expect(expectedInitialKey2).toMatch(/\/2\//)
		}).pipe(Effect.provide(layer))
	})

	it.effect('zero-admin org results in notification_status=scheduled with empty arrays', ({ expect }) => {
		const store = new FakeResendStore()
		const layer = makeLayer([], store) // no admins
		const requesterEmail = `requester-zero-admin-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: null,
			})

			expect(result.accessRequestId).toBeDefined()
			expect(store.sent).toHaveLength(0)

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			expect(row?.notification_status).toBe('scheduled')
			expect(row?.initial_email_attempts).toHaveLength(0)
			expect(row?.scheduled_reminders).toHaveLength(0)
		}).pipe(Effect.provide(layer))
	})

	it.effect('WorkOS list-admins failure → request still inserts with notification_status=failed', ({ expect }) => {
		const store = new FakeResendStore()
		const workosError = new Error('WorkOS unreachable')
		const layer = makeLayer(workosError, store)
		const requesterEmail = `requester-workos-fail-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: null,
			})

			expect(result.accessRequestId).toBeDefined()
			expect(store.sent).toHaveLength(0)

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			expect(row?.notification_status).toBe('failed')
		}).pipe(Effect.provide(layer))
	})

	it.effect('fan-out with 6 admins sends 12 emails total', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = Array.from({ length: 6 }, (_, i) => ({
			userId: `admin-conc-${i}`,
			email: `admin-conc-${i}@example.com`,
		}))
		const layer = makeLayer(admins, store)
		const requesterEmail = `requester-concurrency-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: null,
			})

			// 6 admins × (1 immediate + 1 scheduled) = 12 emails
			expect(store.sent).toHaveLength(12)

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			expect(row?.notification_status).toBe('scheduled')
			expect(row?.initial_email_attempts).toHaveLength(6)
			expect(row?.scheduled_reminders).toHaveLength(6)
		}).pipe(Effect.provide(layer))
	})

	it.effect('partial failure: some admin notifications fail → notification_status=partial', ({ expect }) => {
		const store = new FakeResendStore()
		let sendCallCount = 0

		// First admin succeeds, second fails on sendPlaintext
		const partialResendLayer = Layer.succeed(ResendService, {
			sendPlaintext: (input) => {
				sendCallCount++
				if (sendCallCount % 2 === 0) {
					return Effect.fail(resendOperationError(false))
				}
				const emailId = store.nextId()
				store.sent.push({ type: 'immediate', ...input })
				return Effect.succeed({ emailId })
			},
			schedulePlaintext: (input) => {
				const emailId = store.nextId()
				store.sent.push({
					type: 'scheduled',
					to: input.to,
					subject: input.subject,
					text: input.text,
					idempotencyKey: input.idempotencyKey,
					scheduledAt: input.scheduledAt.toISOString(),
				})
				return Effect.succeed({ emailId, scheduledAt: input.scheduledAt.toISOString() })
			},
			cancelScheduled: () => Effect.succeed(undefined),
			getContact: () => Effect.succeed(null),
			upsertContact: () => Effect.succeed({ contactId: 'contact-test' }),
			patchContactProperties: () => Effect.succeed({ contactId: 'contact-test' }),
			sendEvent: () => Effect.void,
		})

		const admins: FakeAdmin[] = [
			{ userId: 'admin-partial-1', email: 'admin-partial-1@example.com' },
			{ userId: 'admin-partial-2', email: 'admin-partial-2@example.com' },
		]

		const layer = Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(PostgresDbLive(db), makeFakeWorkosLayer(admins), partialResendLayer, ResendConfigTest()),
		)

		const requesterEmail = `requester-partial-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: null,
			})

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			expect(row?.notification_status).toBe('partial')
			expect(row?.initial_email_attempts).toHaveLength(2)
		}).pipe(Effect.provide(layer))
	})

	it.effect('JSONB recorded: initial_email_attempts and scheduled_reminders have correct shape', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = [{ userId: 'admin-jsonb', email: 'admin-jsonb@example.com' }]
		const layer = makeLayer(admins, store)
		const requesterEmail = `requester-jsonb-${randomUUID()}@example.com`

		return Effect.gen(function* () {
			yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe('2026-08-21T12:00:00.000Z')))
			const requestedAt = yield* Clock.currentTimeMillis
			const svc = yield* AccessRequestService
			const result = yield* svc.createAccessRequest({
				artifactId,
				requesterEmail,
				requesterUserId: 'user-jsonb',
			})

			const [row] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, result.accessRequestId)).limit(1),
			)

			const attempts = row?.initial_email_attempts ?? []
			expect(attempts).toHaveLength(1)
			expect(attempts[0]?.adminUserId).toBe('admin-jsonb')
			expect(attempts[0]?.adminEmail).toBe('admin-jsonb@example.com')
			expect(attempts[0]?.resendEmailId).toBeDefined()
			expect(attempts[0]?.sentAt).toBeDefined()

			const reminders = row?.scheduled_reminders ?? []
			expect(reminders).toHaveLength(1)
			expect(reminders[0]?.adminUserId).toBe('admin-jsonb')
			expect(reminders[0]?.resendEmailId).toBeDefined()
			expect(reminders[0]?.scheduledAt).toBeDefined()

			// Service and assertion share the test clock; scheduling is exactly three days after the request.
			const scheduledDate = DateTime.make(reminders[0]?.scheduledAt ?? '')
			expect(Option.isSome(scheduledDate)).toBe(true)
			if (Option.isNone(scheduledDate)) return yield* Effect.die('Expected a valid persisted reminder date')
			expect(DateTime.toEpochMillis(scheduledDate.value)).toBe(requestedAt + 3 * 24 * 60 * 60 * 1000)
		}).pipe(Effect.provide(layer))
	})
})

describe('AccessRequestService.sendInviteAndResolveRequests', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let artifactId: string
	let organizationId: string

	beforeAll(async () => {
		const testDb = await createTestDb('access_request_service_invite')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const workosOrgId = `workos-invite-${randomUUID()}`
		const [org] = await db
			.insert(organizations)
			.values({ name: 'Invite Test Org', workos_organization_id: workosOrgId })
			.returning()
		if (!org) throw new Error('Failed to create org')
		organizationId = org.id

		const content = '# Invite test artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: org.id,
				resource_owner_user_id: 'owner-user',
				file_name: 'invite-test.md',
				content,
				content_hash: hash(content),
				created_by: 'owner-user',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeInviteLayer(
		admins: FakeAdmin[],
		resendStore: FakeResendStore,
		workosOpts: { sendInvitationError?: Error } = {},
	) {
		const workosLayer = Layer.succeed(WorkosService, {
			...makeTestWorkosService(),
			listActiveAdmins: () => Effect.succeed(withFirstName(admins)),
			sendInvitation: () =>
				workosOpts.sendInvitationError
					? Effect.fail(new WorkosServerError({ cause: workosOpts.sendInvitationError }))
					: Effect.succeed({ id: 'inv_test', email: 'test@test.com' } as any),
			getUser: ({ userId }: { userId: string }) =>
				Effect.succeed({ userId, email: `${userId}@example.com`, firstName: null, lastName: null }),
			hasPendingInvitation: () => Effect.succeed(false),
			countActiveOrganizationMemberships: () => Effect.succeed(0),
			countPendingInvitations: () => Effect.succeed(0),
			listUsersByEmail: () => Effect.succeed([]),
			listActiveOrganizationMemberships: () => Effect.succeed([]),
		})

		return Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(PostgresDbLive(db), workosLayer, makeFakeResendLayer(resendStore), ResendConfigTest()),
		)
	}

	async function seedPendingRequestWithReminders(
		requesterEmail: string,
		reminders: Array<{ resendEmailId: string; scheduledAt: string; adminUserId: string; adminEmail: string }>,
	) {
		const [row] = await db
			.insert(accessRequests)
			.values({
				organization_id: organizationId,
				artifact_id: artifactId,
				artifact_title_snapshot: 'invite-test.md',
				artifact_owner_user_id: 'owner-user',
				requester_email: requesterEmail,
				status: 'pending',
				notification_status: 'scheduled',
				scheduled_reminders: reminders.map((r) => ({
					requestGeneration: 1,
					adminUserId: r.adminUserId,
					adminEmail: r.adminEmail,
					resendEmailId: r.resendEmailId,
					scheduledAt: r.scheduledAt,
				})),
			})
			.returning()
		if (!row) throw new Error('Failed to create access request')
		return row
	}

	it.effect('marks pending requests as invited + cancels future reminders', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = [{ userId: 'admin-invite-1', email: 'admin@example.com' }]
		const requesterEmail = `invite-resolve-${randomUUID()}@example.com`

		const reminderEmailId = `resend-cancel-${randomUUID()}`

		const layer = makeInviteLayer(admins, store)

		return Effect.gen(function* () {
			const futureScheduledAt = DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, '4 days'))
			const request = yield* Effect.promise(() =>
				seedPendingRequestWithReminders(requesterEmail, [
					{
						resendEmailId: reminderEmailId,
						scheduledAt: futureScheduledAt,
						adminUserId: 'admin-invite-1',
						adminEmail: 'admin@example.com',
					},
				]),
			)

			const svc = yield* AccessRequestService
			yield* svc.sendInviteAndResolveRequests({
				requesterEmail,
				organizationId,
				workosOrganizationId: 'workos-invite-test',
				actingAdminUserId: 'acting-admin',
			})

			const [updated] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1),
			)

			expect(updated?.status).toBe('invited')
			expect(updated?.notification_status).toBe('canceled')
			expect(updated?.resolved_by_user_id).toBe('acting-admin')
			expect(updated?.resolved_at).toBeDefined()

			// The reminder should have been canceled
			const reminders = updated?.scheduled_reminders ?? []
			expect(reminders).toHaveLength(1)
			expect(reminders[0]?.canceledAt).toBeDefined()
			expect(store.canceled).toContain(reminderEmailId)
		}).pipe(Effect.provide(layer))
	})

	it.effect('handles WorkOS failure gracefully — still resolves access requests', ({ expect }) => {
		const store = new FakeResendStore()
		const admins: FakeAdmin[] = []
		const requesterEmail = `invite-workos-fail-${randomUUID()}@example.com`
		const layer = makeInviteLayer(admins, store, {
			sendInvitationError: new Error('WorkOS unavailable'),
		})

		return Effect.gen(function* () {
			const request = yield* Effect.promise(() => seedPendingRequestWithReminders(requesterEmail, []))

			const svc = yield* AccessRequestService
			// Should not throw even when WorkOS fails
			yield* svc.sendInviteAndResolveRequests({
				requesterEmail,
				organizationId,
				workosOrganizationId: 'workos-invite-test',
				actingAdminUserId: 'acting-admin',
			})

			// Access request should still be resolved
			const [updated] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1),
			)
			expect(updated?.status).toBe('invited')
		}).pipe(Effect.provide(layer))
	})
})

describe('AccessRequestService.backfillRequesterUserId', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let artifactId: string
	let organizationId: string

	beforeAll(async () => {
		const testDb = await createTestDb('access_request_service_backfill')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const workosOrgId = `workos-backfill-${randomUUID()}`
		const [org] = await db
			.insert(organizations)
			.values({ name: 'Backfill Test Org', workos_organization_id: workosOrgId })
			.returning()
		if (!org) throw new Error('Failed to create org')
		organizationId = org.id

		const content = '# Backfill test artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: org.id,
				resource_owner_user_id: 'owner-user',
				file_name: 'backfill-test.md',
				content,
				content_hash: hash(content),
				created_by: 'owner-user',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeBackfillLayer() {
		const workosLayer = Layer.succeed(WorkosService, {
			...makeTestWorkosService(),
			listActiveAdmins: () => Effect.succeed([]),
			sendInvitation: () => Effect.succeed({ id: 'inv_test', email: 'test@test.com' } as any),
			getUser: ({ userId }: { userId: string }) =>
				Effect.succeed({ userId, email: `${userId}@example.com`, firstName: null, lastName: null }),
			hasPendingInvitation: () => Effect.succeed(false),
			countActiveOrganizationMemberships: () => Effect.succeed(0),
			countPendingInvitations: () => Effect.succeed(0),
			listUsersByEmail: () => Effect.succeed([]),
			listActiveOrganizationMemberships: () => Effect.succeed([]),
		})
		const resendStore = new FakeResendStore()
		return Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(PostgresDbLive(db), workosLayer, makeFakeResendLayer(resendStore), ResendConfigTest()),
		)
	}

	it.effect('backfills requester_user_id for anonymous requests matching email', ({ expect }) => {
		const requesterEmail = `backfill-${randomUUID()}@example.com`
		const newUserId = `user-backfill-${randomUUID()}`
		const layer = makeBackfillLayer()

		return Effect.gen(function* () {
			// Create anonymous request (no requester_user_id)
			const rows = yield* Effect.promise(() =>
				db
					.insert(accessRequests)
					.values({
						organization_id: organizationId,
						artifact_id: artifactId,
						artifact_title_snapshot: 'backfill-test.md',
						artifact_owner_user_id: 'owner-user',
						requester_email: requesterEmail,
						requester_user_id: null,
						status: 'pending',
						notification_status: 'not_started',
					})
					.returning(),
			)
			const row = rows[0]
			if (!row) throw new Error('Failed to create request')
			expect(row.requester_user_id).toBeNull()

			const svc = yield* AccessRequestService
			yield* svc.backfillRequesterUserId({ email: requesterEmail, userId: newUserId })

			const [updated] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, row.id)).limit(1),
			)
			expect(updated?.requester_user_id).toBe(newUserId)
		}).pipe(Effect.provide(layer))
	})

	it.effect('does not overwrite existing requester_user_id', ({ expect }) => {
		const requesterEmail = `backfill-existing-${randomUUID()}@example.com`
		const existingUserId = `user-existing-${randomUUID()}`
		const newUserId = `user-new-${randomUUID()}`
		const layer = makeBackfillLayer()

		return Effect.gen(function* () {
			// Create request with existing requester_user_id
			const rows = yield* Effect.promise(() =>
				db
					.insert(accessRequests)
					.values({
						organization_id: organizationId,
						artifact_id: artifactId,
						artifact_title_snapshot: 'backfill-test.md',
						artifact_owner_user_id: 'owner-user',
						requester_email: requesterEmail,
						requester_user_id: existingUserId,
						status: 'pending',
						notification_status: 'not_started',
					})
					.returning(),
			)
			const row = rows[0]
			if (!row) throw new Error('Failed to create request')

			const svc = yield* AccessRequestService
			yield* svc.backfillRequesterUserId({ email: requesterEmail, userId: newUserId })

			// Should NOT have been updated since requester_user_id was already set
			const [updated] = yield* Effect.promise(() =>
				db.select().from(accessRequests).where(eq(accessRequests.id, row.id)).limit(1),
			)
			expect(updated?.requester_user_id).toBe(existingUserId)
		}).pipe(Effect.provide(layer))
	})
})
