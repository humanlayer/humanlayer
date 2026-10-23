import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { ArtifactCommentAnchor } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { deleteCommentProcedure as liveDeleteCommentProcedure } from '../../src/orpc/api/comments/delete.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { getCommentsProcedure } from '../../src/orpc/daemon/comments/get'
import {
	createMockApiAuth,
	createMockApiContext,
	createMockDaemonAuth,
	createMockDaemonContext,
	StatefulMockWorkosService,
} from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/comments/get', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let deleteCommentProcedure: typeof liveDeleteCommentProcedure

	let organizationId: string
	const workosOrganizationId = 'org_comments_daemon_get'
	const userId = 'user_comments_daemon_get'
	const hostId = randomUUID()
	const workos = new StatefulMockWorkosService()

	let taskId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_daemon_get')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		deleteCommentProcedure = bindProcedureToRuntime(liveDeleteCommentProcedure, effectRuntime)

		workos.addUser({
			id: userId,
			email: 'daemon-get@example.com',
			firstName: 'Daemon',
			lastName: 'Getter',
		})

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment daemon get test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'daemon get test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function makeDaemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
				workos,
			},
		})
	}

	function makeApiContext() {
		return createMockApiContext({
			auth: createMockApiAuth({ userId, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createTestArtifact(testName: string) {
		const artifactFilename = `daemon-get-${testName}-${randomUUID().slice(0, 8)}.md`
		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: artifactFilename, content: `# Daemon Get Test: ${testName}` },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		return { artifactId: artifactResult.artifactId, artifactFilename }
	}

	async function insertComment(
		artifactId: string,
		options: {
			contentText: string
			replyToCommentId?: string | null
			isResolved?: boolean
			order: number
			anchorJson?: ArtifactCommentAnchor | null
			commentedUponBlockText?: string | null
			previousBlockText?: string | null
			nextBlockText?: string | null
		},
	) {
		const commentId = randomUUID()
		const createdAt = BigInt(1_700_000_000_000 + options.order)

		await db.insert(artifactComments).values({
			id: commentId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: taskId,
			created_by_user_id: userId,
			artifact_id: artifactId,
			content_text: options.contentText,
			anchor_json: options.anchorJson ?? null,
			commented_upon_block_text: options.commentedUponBlockText ?? null,
			previous_block_text: options.previousBlockText ?? null,
			next_block_text: options.nextBlockText ?? null,
			reply_to_comment_id: options.replyToCommentId ?? null,
			is_resolved: options.isResolved ?? false,
			resolved_by_user_id: options.isResolved ? userId : null,
			created_at: createdAt,
			updated_at: createdAt,
		})

		return commentId
	}

	test('projects V2 anchor quote and context into daemon comment output', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('v2-context')
		const rootId = await insertComment(artifactId, {
			contentText: 'Please revise this section',
			order: 1,
			anchorJson: {
				v: 2,
				scope: 'range',
				selectedText: 'exact selected text',
				start: {
					blockType: 'paragraph',
					blockText: 'the exact selected text in its block',
					offset: 4,
					previousBlockText: 'previous context',
					nextBlockText: 'next context',
				},
				end: {
					blockType: 'paragraph',
					blockText: 'the exact selected text in its block',
					offset: 23,
					previousBlockText: 'previous context',
					nextBlockText: 'next context',
				},
			},
		})
		const replyId = await insertComment(artifactId, {
			contentText: 'Reply without its own target',
			replyToCommentId: rootId,
			order: 2,
		})

		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: false },
			{ context: makeDaemonContext() },
		)

		expect(result.comments.find((comment) => comment.id === rootId)).toMatchObject({
			quotedText: 'exact selected text',
			previousBlockText: 'previous context',
			nextBlockText: 'next context',
		})
		expect(result.comments.find((comment) => comment.id === replyId)).toMatchObject({
			quotedText: null,
			previousBlockText: null,
			nextBlockText: null,
		})
	})

	test('preserves legacy triplet context for V1 roots', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('legacy-context')
		const rootId = await insertComment(artifactId, {
			contentText: 'Legacy feedback',
			order: 1,
			commentedUponBlockText: 'legacy selected block',
			previousBlockText: 'legacy previous block',
			nextBlockText: 'legacy next block',
		})

		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: false },
			{ context: makeDaemonContext() },
		)

		expect(result.comments.find((comment) => comment.id === rootId)).toMatchObject({
			quotedText: 'legacy selected block',
			previousBlockText: 'legacy previous block',
			nextBlockText: 'legacy next block',
		})
	})

	test('includeResolved=false returns unresolved roots and all descendants only', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('unresolved-filter')

		const unresolvedRootId = await insertComment(artifactId, { contentText: 'Unresolved root', order: 1 })
		const unresolvedChildId = await insertComment(artifactId, {
			contentText: 'Resolved child on unresolved thread',
			replyToCommentId: unresolvedRootId,
			isResolved: true,
			order: 2,
		})
		const unresolvedGrandchildId = await insertComment(artifactId, {
			contentText: 'Nested grandchild on unresolved thread',
			replyToCommentId: unresolvedChildId,
			order: 3,
		})
		const resolvedRootId = await insertComment(artifactId, {
			contentText: 'Resolved root',
			isResolved: true,
			order: 4,
		})
		const resolvedChildId = await insertComment(artifactId, {
			contentText: 'Unresolved child on resolved thread',
			replyToCommentId: resolvedRootId,
			order: 5,
		})

		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: false },
			{ context: makeDaemonContext() },
		)

		expect(result.comments.map((comment) => comment.id)).toEqual([
			unresolvedRootId,
			unresolvedChildId,
			unresolvedGrandchildId,
		])
		expect(result.comments.map((comment) => comment.userName)).toEqual([
			'Daemon Getter',
			'Daemon Getter',
			'Daemon Getter',
		])
		expect(result.comments.find((comment) => comment.id === resolvedRootId)).toBeUndefined()
		expect(result.comments.find((comment) => comment.id === resolvedChildId)).toBeUndefined()
		expect(result.comments.find((comment) => comment.id === unresolvedChildId)?.isResolved).toBe(true)
		expect(result.comments.find((comment) => comment.id === unresolvedGrandchildId)?.replyToCommentId).toBe(
			unresolvedChildId,
		)
	})

	test('includeResolved=true returns all roots and descendants in stable chronological order', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('include-resolved')

		const firstRootId = await insertComment(artifactId, { contentText: 'First root', order: 1 })
		const firstChildId = await insertComment(artifactId, {
			contentText: 'First child',
			replyToCommentId: firstRootId,
			order: 2,
		})
		const secondRootId = await insertComment(artifactId, {
			contentText: 'Second root',
			isResolved: true,
			order: 3,
		})
		const secondChildId = await insertComment(artifactId, {
			contentText: 'Second child',
			replyToCommentId: secondRootId,
			isResolved: true,
			order: 4,
		})

		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: true },
			{ context: makeDaemonContext() },
		)

		expect(result.comments.map((comment) => comment.id)).toEqual([
			firstRootId,
			firstChildId,
			secondRootId,
			secondChildId,
		])
		expect(result.comments.map((comment) => comment.isResolved)).toEqual([false, false, true, true])
	})

	test('includeResolved=false still returns legacy nested descendants for an included root', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('legacy-nested')

		const rootId = await insertComment(artifactId, { contentText: 'Legacy nested root', order: 1 })
		const childId = await insertComment(artifactId, {
			contentText: 'Legacy nested child',
			replyToCommentId: rootId,
			order: 2,
		})
		const grandchildId = await insertComment(artifactId, {
			contentText: 'Legacy nested grandchild',
			replyToCommentId: childId,
			isResolved: true,
			order: 3,
		})

		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: false },
			{ context: makeDaemonContext() },
		)

		expect(result.comments.map((comment) => comment.id)).toEqual([rootId, childId, grandchildId])
		expect(result.comments.find((comment) => comment.id === grandchildId)?.replyToCommentId).toBe(childId)
		expect(result.comments.find((comment) => comment.id === grandchildId)?.isResolved).toBe(true)
	})

	test('omits every member after deleting a V2 root through the API', async () => {
		const { artifactId, artifactFilename } = await createTestArtifact('deleted-v2-thread')
		const anchorJson: ArtifactCommentAnchor = {
			v: 2,
			scope: 'block',
			selectedText: 'Deleted thread',
			start: {
				blockType: 'heading',
				blockText: 'Deleted thread',
				previousBlockText: null,
				nextBlockText: null,
				offset: 0,
			},
			end: {
				blockType: 'heading',
				blockText: 'Deleted thread',
				previousBlockText: null,
				nextBlockText: null,
				offset: 14,
			},
		}
		const rootId = await insertComment(artifactId, {
			contentText: 'Delete this V2 root',
			anchorJson,
			order: 1,
		})
		const replyId = await insertComment(artifactId, {
			contentText: 'Delete this reply',
			replyToCommentId: rootId,
			order: 2,
		})
		const nestedReplyId = await insertComment(artifactId, {
			contentText: 'Delete this nested reply',
			replyToCommentId: replyId,
			order: 3,
		})

		await call(deleteCommentProcedure, { commentId: rootId }, { context: makeApiContext() })
		const result = await call(
			getCommentsProcedure,
			{ taskId, artifactFilename, includeResolved: true },
			{ context: makeDaemonContext() },
		)

		const deletedIds = new Set<string>([rootId, replyId, nestedReplyId])
		expect(result.comments.find((comment) => deletedIds.has(comment.id))).toBeUndefined()
	})
})
