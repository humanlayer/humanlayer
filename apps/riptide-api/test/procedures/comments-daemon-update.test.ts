import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { updateCommentProcedure } from '../../src/orpc/daemon/comments/update'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/comments/update', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_daemon_update'
	const userId = 'user_comments_daemon_update'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string
	const artifactFilename = 'daemon-update-test.md'

	beforeAll(async () => {
		const testDb = await createTestDb('comments_daemon_update')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment daemon update test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'daemon update test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: artifactFilename, content: '# Daemon Update Test' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		artifactId = artifactResult.artifactId
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeApiContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	function makeDaemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createComment(contentText: string, replyToCommentId?: string) {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText,
				...(replyToCommentId ? { replyToCommentId } : {}),
			},
			{ context: makeApiContext() },
		)

		return result.commentId
	}

	async function createThreadFixture() {
		const rootId = await createComment('Root comment')
		const childId = await createComment('Child reply', rootId)
		const siblingId = await createComment('Sibling reply', rootId)

		return { rootId, childId, siblingId }
	}

	async function getCommentsByIds(commentIds: string[]) {
		return db
			.select({
				id: artifactComments.id,
				is_resolved: artifactComments.is_resolved,
				resolved_by_user_id: artifactComments.resolved_by_user_id,
				is_deleted: artifactComments.is_deleted,
			})
			.from(artifactComments)
			.where(inArray(artifactComments.id, commentIds))
	}

	test('resolved=true on a reply truncated ID cascades to the full thread', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		const result = await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: [childId.slice(-8)],
				resolved: true,
			},
			{ context: makeDaemonContext() },
		)

		expect(result.success).toBe(true)
		expect(result.updated).toEqual([{ truncatedId: childId.slice(-8), commentId: childId }])
		expect(result.failed).toEqual([])
		expect(result.transactionId).toBeTypeOf('string')

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
	})

	test('resolved=false on a reply truncated ID clears the full thread', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: [rootId.slice(-8)],
				resolved: true,
			},
			{ context: makeDaemonContext() },
		)

		const result = await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: [childId.slice(-8)],
				resolved: false,
			},
			{ context: makeDaemonContext() },
		)

		expect(result.success).toBe(true)
		expect(result.updated).toEqual([{ truncatedId: childId.slice(-8), commentId: childId }])
		expect(result.failed).toEqual([])

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === null)).toBe(true)
	})

	test('deleted updates stay row-scoped when combined with resolved cascade', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		const result = await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: [childId.slice(-8)],
				resolved: true,
				deleted: true,
			},
			{ context: makeDaemonContext() },
		)

		expect(result.success).toBe(true)
		expect(result.updated).toEqual([{ truncatedId: childId.slice(-8), commentId: childId }])
		expect(result.failed).toEqual([])

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.find((row) => row.id === rootId)?.is_deleted).toBe(false)
		expect(rows.find((row) => row.id === childId)?.is_deleted).toBe(true)
		expect(rows.find((row) => row.id === siblingId)?.is_deleted).toBe(false)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
	})

	test('ambiguous truncated IDs are reported without applying updates', async () => {
		const suffix = randomUUID().slice(-12)
		const firstCommentId = `${randomUUID().slice(0, 24)}${suffix}`
		const secondCommentId = `${randomUUID().slice(0, 24)}${suffix}`

		await db.insert(artifactComments).values([
			{
				id: firstCommentId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				created_by_user_id: userId,
				artifact_id: artifactId,
				content_text: 'First ambiguous root',
			},
			{
				id: secondCommentId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				task_id: taskId,
				created_by_user_id: userId,
				artifact_id: artifactId,
				content_text: 'Second ambiguous root',
			},
		])

		const result = await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: [suffix],
				resolved: true,
			},
			{ context: makeDaemonContext() },
		)

		expect(result.success).toBe(false)
		expect(result.updated).toEqual([])
		expect(result.failed).toEqual([{ truncatedId: suffix, reason: 'ambiguous' }])

		const matchingRows = await db
			.select({ id: artifactComments.id, is_resolved: artifactComments.is_resolved })
			.from(artifactComments)
			.where(inArray(artifactComments.id, [firstCommentId, secondCommentId]))

		expect(matchingRows).toHaveLength(2)
		expect(matchingRows.every((row) => row.is_resolved === false)).toBe(true)
	})

	test('missing truncated IDs are reported without applying updates', async () => {
		const result = await call(
			updateCommentProcedure,
			{
				taskId,
				artifactFilename,
				truncatedCommentIds: ['deadbeef'],
				resolved: true,
			},
			{ context: makeDaemonContext() },
		)

		expect(result.success).toBe(false)
		expect(result.updated).toEqual([])
		expect(result.failed).toEqual([{ truncatedId: 'deadbeef', reason: 'not_found' }])

		const [missingComment] = await db
			.select()
			.from(artifactComments)
			.where(eq(artifactComments.content_text, 'deadbeef'))

		expect(missingComment).toBeUndefined()
	})
})
