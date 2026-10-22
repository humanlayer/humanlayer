import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { deleteCommentProcedure as liveDeleteCommentProcedure } from '../../src/orpc/api/comments/delete.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/comments/delete', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let deleteCommentProcedure: typeof liveDeleteCommentProcedure

	let organizationId: string
	const workosOrganizationId = 'org_comments_delete'
	const userId = 'user_comments_delete_author'
	const readerUserId = 'user_comments_delete_reader'
	const strangerUserId = 'user_comments_delete_stranger'
	const editorUserId = 'user_comments_delete_editor'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_delete')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		deleteCommentProcedure = bindProcedureToRuntime(liveDeleteCommentProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment delete test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'delete test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		await db.insert(taskUserAcl).values({
			task_id: taskId,
			subject_user_id: readerUserId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			permission_level: 'read',
			granted_by: userId,
		})

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'delete-test.md', content: '# Delete Test' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		artifactId = artifactResult.artifactId
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function makeContext(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createComment(uid = userId) {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Comment to delete' },
			{ context: makeContext(uid) },
		)
		return result.commentId
	}

	async function createV2Thread() {
		const rootResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'V2 root',
				anchorJson: {
					v: 2,
					scope: 'block',
					selectedText: 'Delete Test',
					start: {
						blockType: 'heading',
						blockText: 'Delete Test',
						previousBlockText: null,
						nextBlockText: null,
						offset: 0,
					},
					end: {
						blockType: 'heading',
						blockText: 'Delete Test',
						previousBlockText: null,
						nextBlockText: null,
						offset: 'Delete Test'.length,
					},
				},
			},
			{ context: makeContext() },
		)
		const replyResult = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Owned reply', replyToCommentId: rootResult.commentId },
			{ context: makeContext() },
		)
		const siblingResult = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Sibling reply', replyToCommentId: rootResult.commentId },
			{ context: makeContext() },
		)
		return { rootId: rootResult.commentId, replyId: replyResult.commentId, siblingId: siblingResult.commentId }
	}

	test('delete soft-tombstones the comment (row still exists, is_deleted=true)', async () => {
		const commentId = await createComment()

		const result = await call(deleteCommentProcedure, { commentId }, { context: makeContext() })

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		// Row still exists (soft delete / tombstone)
		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)

		expect(row).toBeDefined()
		expect(row?.is_deleted).toBe(true)
	})

	test('idempotency: deleting already-deleted comment succeeds', async () => {
		const commentId = await createComment()

		// First delete
		await call(deleteCommentProcedure, { commentId }, { context: makeContext() })

		// Second delete - should succeed without error
		const result = await call(deleteCommentProcedure, { commentId }, { context: makeContext() })

		expect(result.success).toBe(true)
	})

	test('non-author with read access cannot delete comment', async () => {
		const commentId = await createComment(userId)

		await expect(
			call(deleteCommentProcedure, { commentId }, { context: makeContext(readerUserId) }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		// Verify comment is still not deleted
		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)

		expect(row?.is_deleted).toBe(false)
	})

	test('task editor moderates a public comment after link revocation', async () => {
		await db.insert(taskUserAcl).values({
			task_id: taskId,
			subject_user_id: editorUserId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			permission_level: 'edit',
			granted_by: userId,
		})
		const [comment] = await db
			.insert(artifactComments)
			.values({
				artifact_id: artifactId,
				task_id: taskId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by_user_id: strangerUserId,
				created_via_public_share: true,
				content_text: 'Public comment to moderate',
			})
			.returning()
		if (!comment) throw new Error('Unable to insert public comment')
		await db
			.update(artifacts)
			.set({ share_enabled: false, public_permission: 'off' })
			.where(eq(artifacts.id, artifactId))

		await expect(
			call(deleteCommentProcedure, { commentId: comment.id }, { context: makeContext(editorUserId) }),
		).resolves.toMatchObject({ success: true })
		const [deleted] = await db.select().from(artifactComments).where(eq(artifactComments.id, comment.id))
		expect(deleted?.is_deleted).toBe(true)
	})

	test('non-existent comment returns NOT_FOUND', async () => {
		await expect(
			call(deleteCommentProcedure, { commentId: randomUUID() }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('deletes one V2 reply while preserving its root and sibling', async () => {
		const { rootId, replyId, siblingId } = await createV2Thread()

		const result = await call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext() })
		expect(result).toMatchObject({ success: true })
		expect(result.transactionId).toBeTypeOf('string')

		const [replyRow] = await db.select().from(artifactComments).where(eq(artifactComments.id, replyId)).limit(1)
		const [rootRow] = await db.select().from(artifactComments).where(eq(artifactComments.id, rootId)).limit(1)
		const [siblingRow] = await db.select().from(artifactComments).where(eq(artifactComments.id, siblingId)).limit(1)
		expect(replyRow?.is_deleted).toBe(true)
		expect(rootRow?.is_deleted).toBe(false)
		expect(siblingRow?.is_deleted).toBe(false)
	})

	test('deleting a V2 root tombstones the root and every nested descendant', async () => {
		const { rootId, replyId, siblingId } = await createV2Thread()
		await db
			.update(artifactComments)
			.set({ reply_to_comment_id: replyId })
			.where(eq(artifactComments.id, siblingId))

		const result = await call(deleteCommentProcedure, { commentId: rootId }, { context: makeContext() })

		expect(result).toMatchObject({ success: true })
		expect(result.transactionId).toBeTypeOf('string')
		const rows = await db
			.select()
			.from(artifactComments)
			.where(inArray(artifactComments.id, [rootId, replyId, siblingId]))
		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_deleted)).toBe(true)
	})

	test('root deletion handles resolved and already-deleted members and remains repeatable', async () => {
		const { rootId, replyId, siblingId } = await createV2Thread()
		await db
			.update(artifactComments)
			.set({ is_resolved: true, resolved_by_user_id: userId })
			.where(inArray(artifactComments.id, [rootId, replyId, siblingId]))
		await db.update(artifactComments).set({ is_deleted: true }).where(eq(artifactComments.id, replyId))

		await expect(
			call(deleteCommentProcedure, { commentId: rootId }, { context: makeContext() }),
		).resolves.toMatchObject({ success: true })
		await expect(
			call(deleteCommentProcedure, { commentId: rootId }, { context: makeContext() }),
		).resolves.toMatchObject({ success: true })

		const rows = await db
			.select()
			.from(artifactComments)
			.where(inArray(artifactComments.id, [rootId, replyId, siblingId]))
		expect(rows.every((row) => row.is_deleted)).toBe(true)
		expect(rows.every((row) => row.is_resolved)).toBe(true)
	})

	test('deleting a V1 root stays row-scoped', async () => {
		const rootId = await createComment()
		const replyResult = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Legacy reply', replyToCommentId: rootId },
			{ context: makeContext() },
		)

		await call(deleteCommentProcedure, { commentId: rootId }, { context: makeContext() })

		const [rootRow] = await db.select().from(artifactComments).where(eq(artifactComments.id, rootId)).limit(1)
		const [replyRow] = await db
			.select()
			.from(artifactComments)
			.where(eq(artifactComments.id, replyResult.commentId))
			.limit(1)
		expect(rootRow?.is_deleted).toBe(true)
		expect(replyRow?.is_deleted).toBe(false)
	})

	test('rejects an agent-authored V2 root even when its user id matches the caller', async () => {
		const { rootId, replyId } = await createV2Thread()
		await db.update(artifactComments).set({ created_by_agent: true }).where(eq(artifactComments.id, rootId))

		await expect(
			call(deleteCommentProcedure, { commentId: rootId }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const rows = await db
			.select()
			.from(artifactComments)
			.where(inArray(artifactComments.id, [rootId, replyId]))
		expect(rows.every((row) => !row.is_deleted)).toBe(true)
	})

	test('rejects an agent-authored reply even when its user id matches the caller', async () => {
		const { replyId } = await createV2Thread()
		await db.update(artifactComments).set({ created_by_agent: true }).where(eq(artifactComments.id, replyId))

		await expect(
			call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, replyId)).limit(1)
		expect(row?.is_deleted).toBe(false)
	})

	test('checks ownership before idempotency for an already-deleted row', async () => {
		const { replyId } = await createV2Thread()
		await call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext() })

		await expect(
			call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext(readerUserId) }),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
		await expect(
			call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext() }),
		).resolves.toMatchObject({ success: true })
	})

	test('hides an accessible row from callers without task read access', async () => {
		const { replyId } = await createV2Thread()

		await expect(
			call(deleteCommentProcedure, { commentId: replyId }, { context: makeContext(strangerUserId) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
