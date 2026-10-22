import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { resolveCommentProcedure } from '../../src/orpc/api/comments/resolve'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/comments/resolve', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_resolve'
	const userId = 'user_comments_resolve'
	const strangerUserId = 'user_comments_stranger'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_resolve')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment resolve test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'resolve test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'resolve-test.md', content: '# Resolve Test' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		artifactId = artifactResult.artifactId
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function makeContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createComment(contentText = 'A comment to resolve', replyToCommentId?: string) {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText,
				...(replyToCommentId ? { replyToCommentId } : {}),
			},
			{ context: makeContext() },
		)
		return result.commentId
	}

	async function getCommentsByIds(commentIds: string[]) {
		return db
			.select({
				id: artifactComments.id,
				is_resolved: artifactComments.is_resolved,
				resolved_by_user_id: artifactComments.resolved_by_user_id,
				reply_to_comment_id: artifactComments.reply_to_comment_id,
			})
			.from(artifactComments)
			.where(inArray(artifactComments.id, commentIds))
	}

	async function createThreadFixture() {
		const rootId = await createComment('Root comment')
		const childId = await createComment('Child reply', rootId)
		const siblingId = await createComment('Sibling reply', rootId)

		return { rootId, childId, siblingId }
	}

	test('resolve sets is_resolved=true and resolved_by_user_id', async () => {
		const commentId = await createComment('Resolve me')

		const result = await call(resolveCommentProcedure, { commentId, isResolved: true }, { context: makeContext() })

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)

		expect(row?.is_resolved).toBe(true)
		expect(row?.resolved_by_user_id).toBe(userId)
	})

	test('unresolve sets is_resolved=false and clears resolved_by_user_id', async () => {
		const commentId = await createComment('Unresolve me')

		await call(resolveCommentProcedure, { commentId, isResolved: true }, { context: makeContext() })

		const result = await call(resolveCommentProcedure, { commentId, isResolved: false }, { context: makeContext() })

		expect(result.success).toBe(true)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)

		expect(row?.is_resolved).toBe(false)
		expect(row?.resolved_by_user_id).toBeNull()
	})

	test('resolve from root ID cascades to the full thread', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		const result = await call(
			resolveCommentProcedure,
			{ commentId: rootId, isResolved: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
	})

	test('resolve from reply ID cascades to root and siblings', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		const result = await call(
			resolveCommentProcedure,
			{ commentId: childId, isResolved: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
	})

	test('unresolve from reply ID clears resolved state for the full thread', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		await call(resolveCommentProcedure, { commentId: rootId, isResolved: true }, { context: makeContext() })

		const result = await call(
			resolveCommentProcedure,
			{ commentId: childId, isResolved: false },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === null)).toBe(true)
	})

	test('idempotency: resolving already-resolved comment succeeds without error', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		await call(resolveCommentProcedure, { commentId: rootId, isResolved: true }, { context: makeContext() })

		const result = await call(
			resolveCommentProcedure,
			{ commentId: childId, isResolved: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
	})

	test('resolve/unresolve cycles keep thread member metadata consistent', async () => {
		const { rootId, childId, siblingId } = await createThreadFixture()

		await call(resolveCommentProcedure, { commentId: rootId, isResolved: true }, { context: makeContext() })

		let rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)

		await call(resolveCommentProcedure, { commentId: childId, isResolved: false }, { context: makeContext() })

		rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === null)).toBe(true)

		await call(resolveCommentProcedure, { commentId: siblingId, isResolved: true }, { context: makeContext() })

		rows = await getCommentsByIds([rootId, childId, siblingId])
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
	})

	test('resolving a legacy nested reply cascades to all descendants in the thread', async () => {
		const rootId = await createComment('Legacy root comment')
		const childId = await createComment('Legacy child reply', rootId)
		const siblingId = await createComment('Legacy sibling reply', rootId)
		const grandchildId = randomUUID()

		await db.insert(artifactComments).values({
			id: grandchildId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: taskId,
			created_by_user_id: userId,
			artifact_id: artifactId,
			content_text: 'Legacy nested grandchild',
			reply_to_comment_id: childId,
		})

		const result = await call(
			resolveCommentProcedure,
			{ commentId: grandchildId, isResolved: true },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const rows = await getCommentsByIds([rootId, childId, siblingId, grandchildId])
		expect(rows).toHaveLength(4)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
		expect(rows.every((row) => row.resolved_by_user_id === userId)).toBe(true)
		expect(rows.find((row) => row.id === grandchildId)?.reply_to_comment_id).toBe(childId)
	})

	test('non-existent comment returns NOT_FOUND', async () => {
		await expect(
			call(resolveCommentProcedure, { commentId: randomUUID(), isResolved: true }, { context: makeContext() }),
		).rejects.toThrow()
	})

	test('user without task read access cannot resolve - FORBIDDEN', async () => {
		const commentId = await createComment('Forbidden resolve attempt')

		await expect(
			call(resolveCommentProcedure, { commentId, isResolved: true }, { context: makeContext(strangerUserId) }),
		).rejects.toThrow()

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)

		expect(row?.is_resolved).toBe(false)
	})
})
