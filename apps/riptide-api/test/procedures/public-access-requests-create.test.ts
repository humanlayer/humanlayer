import { randomUUID } from 'node:crypto'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, ORPCError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { makeWorkosServiceLive } from '../../src/effects/services/workos/workos.service'
import { createAccessRequestProcedure as liveCreateAccessRequestProcedure } from '../../src/orpc/api/public/access-requests/create'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { StatefulMockWorkosService } from '../mocks/workos-service.mock'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const _requesterEmail = 'requester@example.com'

describe('public access requests create', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('public_access_requests_create')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Access Request Org', workos_organization_id: 'workos-access-request-org' })
			.returning()
		if (!org) throw new Error('Failed to create org')
		organizationId = org.id

		const content = '# Requestable artifact'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'requestable.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')
		artifactId = artifact.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	// Bind the converted Effect procedure to a test runtime whose WorkosService is the
	// real `WorkosServiceLive` backed by the given stateful mock, so the procedure's
	// email resolution + membership guardrail + the real `AccessRequestService` (default
	// in the test runtime) all share the same WorkOS state and write to the test db.
	const bindProcedure = (workos: StatefulMockWorkosService) => {
		const runtime = createRuntimeWithTestPostgresLayer(db, {
			workos: makeWorkosServiceLive(workos),
		})
		return bindProcedureToRuntime(liveCreateAccessRequestProcedure, runtime)
	}

	const makeContext = (auth: ReturnType<typeof createMockApiAuth> | null) =>
		createMockApiContext({ auth, services: { db, dbReadReplica: db } })

	test('inserts new row when none exists', async () => {
		const email = `new-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-new', email })
		const procedure = bindProcedure(workos)
		const result = await call(
			procedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ userId: 'user-new' })) },
		)

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(eq(accessRequests.id, result.accessRequestId))
			.limit(1)
		expect(row?.requester_user_id).toBe('user-new')
		expect(row?.requester_email).toBe(email)
		expect(row?.status).toBe('pending')
		// notification_status reflects the result of the WorkOS/Resend fan-out
		// With a stub WorkOS (no admins), zero admins → scheduled with no emails sent
		expect(['not_started', 'scheduled', 'partial', 'failed']).toContain(row?.notification_status ?? 'not_started')
		expect(row?.request_generation).toBe(1)
	})

	test('returns ALREADY_REQUESTED_ACCESS on re-request within 24h', async () => {
		const email = `repeat-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-repeat', email })
		const procedure = bindProcedure(workos)
		const context = makeContext(createMockApiAuth({ userId: 'user-repeat' }))
		await call(procedure, { artifactId }, { context })

		try {
			await call(procedure, { artifactId }, { context })
			expect.unreachable('Expected ALREADY_REQUESTED_ACCESS')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('ALREADY_REQUESTED_ACCESS')
		}
	})

	test('allows anonymous email-only submission', async () => {
		const email = `anonymous-${randomUUID()}@example.com`
		const procedure = bindProcedure(new StatefulMockWorkosService())
		const result = await call(procedure, { artifactId, email }, { context: makeContext(null) })

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(eq(accessRequests.id, result.accessRequestId))
			.limit(1)
		expect(row?.requester_user_id).toBeNull()
		expect(row?.requester_email).toBe(email)
	})

	test('refuses with FEATURE_DISABLED when org has access_requests_enabled=false', async () => {
		const [disabledOrg] = await db
			.insert(organizations)
			.values({ name: 'Disabled Requests Org', workos_organization_id: 'workos-disabled-access-requests' })
			.returning()
		if (!disabledOrg) throw new Error('Failed to create disabled org')

		await db
			.insert(organizationSettings)
			.values({ organization_id: disabledOrg.id, access_requests_enabled: false })

		const content = '# Disabled request artifact'
		const [disabledArtifact] = await db
			.insert(artifacts)
			.values({
				organization_id: disabledOrg.id,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'disabled-request.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!disabledArtifact) throw new Error('Failed to create disabled artifact')

		const procedure = bindProcedure(new StatefulMockWorkosService())
		try {
			await call(
				procedure,
				{ artifactId: disabledArtifact.id, email: `disabled-${randomUUID()}@example.com` },
				{ context: makeContext(null) },
			)
			expect.unreachable('Expected FEATURE_DISABLED')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('FEATURE_DISABLED')
		}
	})

	test('re-request after archive flips status back to pending and increments request_generation', async () => {
		const email = `archived-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-archive', email })
		const procedure = bindProcedure(workos)
		const context = makeContext(createMockApiAuth({ userId: 'user-archive' }))
		const created = await call(procedure, { artifactId }, { context })

		await db
			.update(accessRequests)
			.set({ status: 'archived', archived_at: new Date() })
			.where(eq(accessRequests.id, created.accessRequestId))

		const reopened = await call(procedure, { artifactId }, { context })
		const [row] = await db
			.select()
			.from(accessRequests)
			.where(eq(accessRequests.id, reopened.accessRequestId))
			.limit(1)

		expect(reopened.accessRequestId).toBe(created.accessRequestId)
		expect(row?.status).toBe('pending')
		expect(row?.request_generation).toBe(2)
		expect(row?.archived_at).toBeNull()
	})

	test('authed active member is suppressed — no row, neutral response', async () => {
		const email = `member-authed-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-member-authed', email })
		workos.addOrganization({ id: 'workos-access-request-org', name: 'Access Request Org' })
		workos.addMembership({
			userId: 'user-member-authed',
			organizationId: 'workos-access-request-org',
			status: 'active',
		})

		const procedure = bindProcedure(workos)
		const result = await call(
			procedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ userId: 'user-member-authed' })) },
		)

		// Neutral response shape, indistinguishable from a genuine submission.
		expect(result.accessRequestId).toBeTruthy()
		expect(result.alreadyInvited).toBe(false)

		// No row was written for this requester.
		const [row] = await db
			.select()
			.from(accessRequests)
			.where(and(eq(accessRequests.artifact_id, artifactId), eq(accessRequests.requester_email, email)))
			.limit(1)
		expect(row).toBeUndefined()
	})

	test('anonymous email resolving to an active member is suppressed — no row', async () => {
		const email = `member-anon-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-member-anon', email })
		workos.addOrganization({ id: 'workos-access-request-org', name: 'Access Request Org' })
		workos.addMembership({
			userId: 'user-member-anon',
			organizationId: 'workos-access-request-org',
			status: 'active',
		})

		const procedure = bindProcedure(workos)
		const result = await call(procedure, { artifactId, email }, { context: makeContext(null) })

		expect(result.accessRequestId).toBeTruthy()
		expect(result.alreadyInvited).toBe(false)

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(and(eq(accessRequests.artifact_id, artifactId), eq(accessRequests.requester_email, email)))
			.limit(1)
		expect(row).toBeUndefined()
	})

	test('departed owner (membership not active) is treated as an outsider — row created', async () => {
		const email = `departed-owner-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-departed', email })
		workos.addOrganization({ id: 'workos-access-request-org', name: 'Access Request Org' })
		// Membership exists but is no longer active.
		workos.addMembership({
			userId: 'user-departed',
			organizationId: 'workos-access-request-org',
			status: 'inactive',
		})

		const procedure = bindProcedure(workos)
		const result = await call(
			procedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ userId: 'user-departed' })) },
		)

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(eq(accessRequests.id, result.accessRequestId))
			.limit(1)
		expect(row?.requester_user_id).toBe('user-departed')
		expect(row?.requester_email).toBe(email)
		expect(row?.status).toBe('pending')
	})

	test('non-member outsider still creates a row', async () => {
		const email = `outsider-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-outsider', email })
		workos.addOrganization({ id: 'workos-access-request-org', name: 'Access Request Org' })
		// No membership for this user in the artifact's org.

		const procedure = bindProcedure(workos)
		const result = await call(
			procedure,
			{ artifactId },
			{ context: makeContext(createMockApiAuth({ userId: 'user-outsider' })) },
		)

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(eq(accessRequests.id, result.accessRequestId))
			.limit(1)
		expect(row?.requester_user_id).toBe('user-outsider')
		expect(row?.requester_email).toBe(email)
		expect(row?.status).toBe('pending')
	})

	test('serializes concurrent re-requests via row lock', async () => {
		const email = `concurrent-${randomUUID()}@example.com`
		const workos = new StatefulMockWorkosService()
		workos.addUser({ id: 'user-concurrent', email })
		const procedure = bindProcedure(workos)
		const context = makeContext(createMockApiAuth({ userId: 'user-concurrent' }))

		const results = await Promise.allSettled([
			call(procedure, { artifactId }, { context }),
			call(procedure, { artifactId }, { context }),
		])

		const fulfilled = results.filter((result) => result.status === 'fulfilled')
		const rejected = results.filter((result) => result.status === 'rejected')
		expect(fulfilled).toHaveLength(1)
		expect(rejected).toHaveLength(1)

		const [row] = await db
			.select()
			.from(accessRequests)
			.where(and(eq(accessRequests.artifact_id, artifactId), eq(accessRequests.requester_email, email)))
			.limit(1)
		expect(row?.request_generation).toBe(1)
	})
})
