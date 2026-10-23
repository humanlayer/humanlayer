import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { deleteCommentProcedure as liveDeleteCommentProcedure } from '../../src/orpc/api/comments/delete.effect'
import { editCommentProcedure as liveEditCommentProcedure } from '../../src/orpc/api/comments/edit.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const wholeBlockAnchor = {
	v: 2 as const,
	scope: 'block' as const,
	selectedText: 'Edit target',
	start: {
		blockType: 'paragraph',
		blockText: 'Edit target',
		previousBlockText: null,
		nextBlockText: null,
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Edit target',
		previousBlockText: null,
		nextBlockText: null,
		offset: 'Edit target'.length,
	},
}

describe('api/comments/edit (effect)', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let editCommentProcedure: typeof liveEditCommentProcedure
	let deleteCommentProcedure: typeof liveDeleteCommentProcedure

	let organizationId: string
	const workosOrganizationId = 'org_comments_edit'
	const userId = 'user_comments_edit_author'
	const readerUserId = 'user_comments_edit_reader'
	const strangerUserId = 'user_comments_edit_stranger'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_edit')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		editCommentProcedure = bindProcedureToRuntime(liveEditCommentProcedure, effectRuntime)
		deleteCommentProcedure = bindProcedureToRuntime(liveDeleteCommentProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'comment edit test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'edit test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		// Grant readerUserId read-only access so it can read the task but cannot edit.
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
			{ taskId, fileName: 'edit-test.md', content: '# Edit Test' },
			{ context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }) },
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
			{ artifactId, contentText: 'Original content' },
			{ context: makeContext(uid) },
		)
		return result.commentId
	}

	async function createV2Thread() {
		const structuredContent = { type: 'doc', content: [{ type: 'paragraph', attrs: { kept: true } }] }
		const rootResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'V2 root content',
				contentJson: structuredContent,
				anchorJson: wholeBlockAnchor,
				kind: 'approval',
			},
			{ context: makeContext() },
		)
		const replyResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'V2 reply content',
				contentJson: structuredContent,
				replyToCommentId: rootResult.commentId,
			},
			{ context: makeContext() },
		)
		return { rootId: rootResult.commentId, replyId: replyResult.commentId, structuredContent }
	}

	test('author edit updates content and returns transactionId', async () => {
		const commentId = await createComment()

		const result = await call(
			editCommentProcedure,
			{ commentId, contentText: 'Edited content', contentJson: { type: 'doc' } },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		expect(result.transactionId).toBeTypeOf('string')

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		expect(row?.content_text).toBe('Edited content')
		expect(row?.content_json).toEqual({ type: 'doc' })
	})

	test.each(['root', 'reply'] as const)('edits a V2 %s without changing row context', async (target) => {
		const { rootId, replyId, structuredContent } = await createV2Thread()
		const commentId = target === 'root' ? rootId : replyId
		const [before] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		if (!before) throw new Error('Missing V2 comment fixture')

		await call(
			editCommentProcedure,
			{ commentId, contentText: `Edited V2 ${target}`, contentJson: structuredContent },
			{ context: makeContext() },
		)

		const [after] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		expect(after).toMatchObject({
			content_text: `Edited V2 ${target}`,
			content_json: structuredContent,
			anchor_json: before.anchor_json,
			kind: before.kind,
			reply_to_comment_id: before.reply_to_comment_id,
			is_resolved: before.is_resolved,
			resolved_by_user_id: before.resolved_by_user_id,
			created_at_artifact_version_id: before.created_at_artifact_version_id,
		})
		expect(after?.updated_at).toBeGreaterThanOrEqual(before.updated_at)
	})

	test('rejects agent-authored rows even when the caller user id matches', async () => {
		const commentId = await createComment()
		await db.update(artifactComments).set({ created_by_agent: true }).where(eq(artifactComments.id, commentId))

		for (let attempt = 0; attempt < 2; attempt += 1) {
			await expect(
				call(editCommentProcedure, { commentId, contentText: 'Agent rewrite' }, { context: makeContext() }),
			).rejects.toMatchObject({ code: 'FORBIDDEN' })
		}

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		expect(row?.content_text).toBe('Original content')
	})

	test('non-existent comment returns NOT_FOUND', async () => {
		await expect(
			call(editCommentProcedure, { commentId: randomUUID(), contentText: 'nope' }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('non-author with read access returns FORBIDDEN', async () => {
		const commentId = await createComment(userId)

		await expect(
			call(
				editCommentProcedure,
				{ commentId, contentText: 'sneaky edit' },
				{ context: makeContext(readerUserId) },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		expect(row?.content_text).toBe('Original content')
	})

	test('caller without read access returns NOT_FOUND (existence hiding)', async () => {
		const commentId = await createComment(userId)

		await expect(
			call(editCommentProcedure, { commentId, contentText: 'hidden' }, { context: makeContext(strangerUserId) }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('soft-deleted comment returns NOT_FOUND', async () => {
		const commentId = await createComment()
		await call(deleteCommentProcedure, { commentId }, { context: makeContext() })

		await expect(
			call(editCommentProcedure, { commentId, contentText: 'edit after delete' }, { context: makeContext() }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
