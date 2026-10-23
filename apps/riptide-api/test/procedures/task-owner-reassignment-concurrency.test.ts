import { tmpdir } from 'node:os'

import { describe, it } from '@effect/vitest'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import {
	formatPostgresDatabaseUrl,
	getExternalTestServicesConfig,
} from '@humanlayer/test-fixtures/external-test-services'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import postgres from 'postgres'
import { afterAll, beforeAll, expect } from 'vitest'

import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { reassignTaskOwner } from '../../src/effects/task-owner-reassignment/reassign-task-owner'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const ownerUserId = 'user_concurrency_owner'
const newOwnerUserId = 'user_concurrency_new_owner'
const workosOrganizationId = 'org_concurrency'

describe('task owner reassignment concurrency', () => {
	let db: PostgresJsDatabase
	let databaseName: string
	let organizationId: string
	let cleanup: (() => Promise<void>) | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('task_owner_reassignment_concurrency')
		db = testDb.db
		databaseName = testDb.databaseName
		cleanup = testDb.cleanup
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Concurrency tests', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Failed to create test organization')
		organizationId = organization.id
	}, 30_000)

	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	const workosService: typeof WorkosService.Service = {
		createUserApiKey: () => Effect.die('Unexpected WorkOS call'),
		listUserApiKeys: () => Effect.die('Unexpected WorkOS call'),
		validateApiKey: () => Effect.die('Unexpected WorkOS call'),
		deleteApiKey: () => Effect.die('Unexpected WorkOS call'),
		listActiveAdmins: () => Effect.die('Unexpected WorkOS call'),
		sendInvitation: () => Effect.die('Unexpected WorkOS call'),
		getUser: () => Effect.die('Unexpected WorkOS call'),
		hasPendingInvitation: () => Effect.die('Unexpected WorkOS call'),
		countActiveOrganizationMemberships: () => Effect.die('Unexpected WorkOS call'),
		countPendingInvitations: () => Effect.die('Unexpected WorkOS call'),
		listUsersByEmail: () => Effect.die('Unexpected WorkOS call'),
		listActiveOrganizationMemberships: ({ userId, organizationId: requestedOrganizationId }) =>
			Effect.succeed([{ userId, organizationId: requestedOrganizationId }]),
	}

	const createTaskAndSession = async (name: string) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name,
				created_by: ownerUserId,
				resource_owner_user_id: ownerUserId,
				default_working_directory: tmpdir(),
			})
			.returning()
		if (!task) throw new Error('Failed to create task')
		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task.id,
				organization_id: organizationId,
				created_by: ownerUserId,
				resource_owner_user_id: ownerUserId,
				host_id: crypto.randomUUID(),
				working_directory: tmpdir(),
				status: 'running',
			})
			.returning()
		if (!session) throw new Error('Failed to create session')
		return { task, session }
	}

	const runReassignment = (taskId: string) =>
		Effect.runPromise(
			reassignTaskOwner({
				taskId,
				newOwnerUserId,
				actingUserId: ownerUserId,
				organizationId,
				workosOrganizationId,
				actingUserIsOrganizationAdmin: false,
			}).pipe(Effect.provide(Layer.merge(PostgresDbLive(db), Layer.succeed(WorkosService, workosService)))),
		)

	const makeConnection = () => {
		const config = getExternalTestServicesConfig()
		return postgres(formatPostgresDatabaseUrl(config, databaseName), {
			max: 1,
			connection: { lock_timeout: 5_000, statement_timeout: 10_000 },
		})
	}

	it.effect('writer-first ordering cascades a row inserted under the session lock', () =>
		Effect.gen(function* () {
			const { task, session } = yield* Effect.promise(() => createTaskAndSession('writer first'))
			const writer = makeConnection()
			let releaseWriter: (() => void) | undefined
			const release = new Promise<void>((resolve) => {
				releaseWriter = resolve
			})
			let announceLock: (() => void) | undefined
			const locked = new Promise<void>((resolve) => {
				announceLock = resolve
			})

			const writerTransaction = writer.begin(async (sql) => {
				await sql`select id from tasks where id = ${task.id} for update`
				await sql`select id from sessions where id = ${session.id} for update`
				announceLock?.()
				await release
				await sql`
					insert into conversation_events (
						session_id, organization_id, resource_owner_user_id, task_id, event_type, role, content
					) values (
						${session.id}, ${organizationId}, ${ownerUserId}, ${task.id}, 'message', 'user', 'writer-first'
					)
				`
			})

			yield* Effect.promise(() => locked)
			const reassignment = runReassignment(task.id)
			releaseWriter?.()
			yield* Effect.promise(() => Promise.all([writerTransaction, reassignment]))
			yield* Effect.promise(() => writer.end({ timeout: 5 }))

			const [event] = yield* Effect.promise(() =>
				db.select().from(conversationEvents).where(eq(conversationEvents.session_id, session.id)),
			)
			expect(event?.resource_owner_user_id).toBe(newOwnerUserId)
		}),
	)

	it.effect('reassignment-first ordering makes a blocked writer read the new owner', () =>
		Effect.gen(function* () {
			const { task, session } = yield* Effect.promise(() => createTaskAndSession('reassignment first'))
			const reassigner = makeConnection()
			const writer = makeConnection()
			let releaseReassignment: (() => void) | undefined
			const release = new Promise<void>((resolve) => {
				releaseReassignment = resolve
			})
			let announceUpdate: (() => void) | undefined
			const updated = new Promise<void>((resolve) => {
				announceUpdate = resolve
			})

			const reassignmentTransaction = reassigner.begin(async (sql) => {
				await sql`update tasks set resource_owner_user_id = ${newOwnerUserId} where id = ${task.id}`
				await sql`update sessions set resource_owner_user_id = ${newOwnerUserId} where id = ${session.id}`
				announceUpdate?.()
				await release
			})

			yield* Effect.promise(() => updated)
			const writerTransaction = writer.begin(async (sql) => {
				const rows = await sql<{ resource_owner_user_id: string }[]>`
					select resource_owner_user_id from sessions where id = ${session.id} for update
				`
				const source = rows[0]
				if (!source) throw new Error('Session disappeared during concurrency test')
				await sql`
					insert into conversation_events (
						session_id, organization_id, resource_owner_user_id, task_id, event_type, role, content
					) values (
						${session.id}, ${organizationId}, ${source.resource_owner_user_id}, ${task.id},
						'message', 'user', 'reassignment-first'
					)
				`
			})
			releaseReassignment?.()
			yield* Effect.promise(() => Promise.all([reassignmentTransaction, writerTransaction]))
			yield* Effect.promise(() => Promise.all([reassigner.end({ timeout: 5 }), writer.end({ timeout: 5 })]))

			const [event] = yield* Effect.promise(() =>
				db.select().from(conversationEvents).where(eq(conversationEvents.session_id, session.id)),
			)
			expect(event?.resource_owner_user_id).toBe(newOwnerUserId)
		}),
	)
})
