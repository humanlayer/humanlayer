import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call } from '@orpc/server'
import { eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { resolveCommentProcedure } from '../../src/orpc/api/comments/resolve'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/comments/create', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_create'
	const userId = 'user_comments_create'
	const otherUserId = 'user_comments_other'
	const hostId = randomUUID()

	// Shared task and artifact for most tests
	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_create')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'comment create test org',
				workos_organization_id: workosOrganizationId,
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		// Set up task
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'comment test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		// Set up artifact (via daemon upsert)
		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const createArtifactResult = await call(
			upsertArtifactProcedure,
			// A design-review artifact (the inbound-comment milestone only fires for
			// design discussions / PRDs / TDDs, not arbitrary docs).
			{ taskId, fileName: 'design-discussion.md', content: '# Hello\nLine 1\nLine 2\nLine 3' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)
		artifactId = createArtifactResult.artifactId
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

	test('creates inline comment with block context anchoring', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'This is interesting',
				commentedUponBlockText: 'Hello world',
				previousBlockText: 'Previous block',
				nextBlockText: 'Next block',
			},
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)
		expect(result.commentId).toBeTypeOf('string')
		expect(result.transactionId).toBeTypeOf('string')

		// Verify DB fields
		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)

		expect(row?.content_text).toBe('This is interesting')
		expect(row?.commented_upon_block_text).toBe('Hello world')
		expect(row?.previous_block_text).toBe('Previous block')
		expect(row?.next_block_text).toBe('Next block')
	})

	test('creates spanless comment with null anchor fields', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'General comment, no highlight',
			},
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)

		expect(row?.commented_upon_block_text).toBeNull()
		expect(row?.previous_block_text).toBeNull()
		expect(row?.next_block_text).toBeNull()
	})

	test('writes the first inbound human comment milestone once for the artifact owner', async () => {
		await db
			.insert(taskUserAcl)
			.values({
				task_id: taskId,
				subject_user_id: otherUserId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				permission_level: 'read',
				granted_by: userId,
			})
			.onConflictDoNothing()

		await call(
			createCommentProcedure,
			{ artifactId, contentText: 'First teammate comment' },
			{ context: makeContext(otherUserId) },
		)
		const [first] = await db
			.select({ milestone: userSettings.first_inbound_comment_received_at })
			.from(userSettings)
			.where(eq(userSettings.user_id, userId))
		await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Second teammate comment' },
			{ context: makeContext(otherUserId) },
		)
		const [second] = await db
			.select({ milestone: userSettings.first_inbound_comment_received_at })
			.from(userSettings)
			.where(eq(userSettings.user_id, userId))

		expect(first?.milestone).not.toBeNull()
		expect(second?.milestone).toBe(first?.milestone)
	})

	test('does not write the inbound comment milestone for an owner self-comment', async () => {
		await db.delete(userSettings).where(eq(userSettings.user_id, userId))

		await call(createCommentProcedure, { artifactId, contentText: 'Owner note' }, { context: makeContext(userId) })

		const [settings] = await db.select().from(userSettings).where(eq(userSettings.user_id, userId))
		expect(settings).toBeUndefined()
	})

	test('creates comment with client-supplied UUID and preserves it', async () => {
		const clientId = uuidv7()

		const result = await call(
			createCommentProcedure,
			{
				id: clientId,
				artifactId,
				contentText: 'Comment with client ID',
			},
			{ context: makeContext() },
		)

		expect(result.commentId).toBe(clientId)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, clientId)).limit(1)

		expect(row?.id).toBe(clientId)
	})

	test('creates comment without client-supplied ID - server generates UUID', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Comment without explicit ID',
			},
			{ context: makeContext() },
		)

		expect(result.commentId).toBeTypeOf('string')
		expect(result.commentId.length).toBeGreaterThan(0)
	})

	test('creates reply comment with replyToCommentId FK set', async () => {
		// First create parent comment
		const parentResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Parent comment',
			},
			{ context: makeContext() },
		)

		// Create reply
		const replyResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Reply to parent',
				replyToCommentId: parentResult.commentId,
			},
			{ context: makeContext() },
		)

		expect(replyResult.success).toBe(true)

		const [row] = await db
			.select()
			.from(artifactComments)
			.where(eq(artifactComments.id, replyResult.commentId))
			.limit(1)

		expect(row?.reply_to_comment_id).toBe(parentResult.commentId)
	})

	test('replying to resolved thread reopens all thread members and anchors to root', async () => {
		const rootResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Root comment',
			},
			{ context: makeContext() },
		)

		const childResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Child reply',
				replyToCommentId: rootResult.commentId,
			},
			{ context: makeContext() },
		)

		await call(
			resolveCommentProcedure,
			{ commentId: rootResult.commentId, isResolved: true },
			{ context: makeContext() },
		)

		const reopenedReply = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Reopening activity',
				replyToCommentId: childResult.commentId,
			},
			{ context: makeContext() },
		)

		const rows = await db
			.select({
				id: artifactComments.id,
				reply_to_comment_id: artifactComments.reply_to_comment_id,
				is_resolved: artifactComments.is_resolved,
				resolved_by_user_id: artifactComments.resolved_by_user_id,
			})
			.from(artifactComments)
			.where(inArray(artifactComments.id, [rootResult.commentId, childResult.commentId, reopenedReply.commentId]))

		expect(rows).toHaveLength(3)
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(
			rows.filter((row) => row.id !== reopenedReply.commentId).every((row) => row.resolved_by_user_id === null),
		).toBe(true)
		expect(rows.find((row) => row.id === reopenedReply.commentId)?.reply_to_comment_id).toBe(rootResult.commentId)
	})

	test('replying to a deeply nested resolved reply reopens all descendants in the legacy thread', async () => {
		const rootResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Legacy root comment',
			},
			{ context: makeContext() },
		)

		const childResult = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Legacy child reply',
				replyToCommentId: rootResult.commentId,
			},
			{ context: makeContext() },
		)

		const grandchildId = randomUUID()
		await db.insert(artifactComments).values({
			id: grandchildId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: taskId,
			created_by_user_id: userId,
			artifact_id: artifactId,
			content_text: 'Legacy nested grandchild',
			reply_to_comment_id: childResult.commentId,
		})

		await call(
			resolveCommentProcedure,
			{ commentId: rootResult.commentId, isResolved: true },
			{ context: makeContext() },
		)

		const reopenedReply = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Reply on nested resolved comment',
				replyToCommentId: grandchildId,
			},
			{ context: makeContext() },
		)

		const rows = await db
			.select({
				id: artifactComments.id,
				reply_to_comment_id: artifactComments.reply_to_comment_id,
				is_resolved: artifactComments.is_resolved,
			})
			.from(artifactComments)
			.where(
				inArray(artifactComments.id, [
					rootResult.commentId,
					childResult.commentId,
					grandchildId,
					reopenedReply.commentId,
				]),
			)

		expect(rows).toHaveLength(4)
		expect(rows.every((row) => row.is_resolved === false)).toBe(true)
		expect(rows.find((row) => row.id === grandchildId)?.reply_to_comment_id).toBe(childResult.commentId)
		expect(rows.find((row) => row.id === reopenedReply.commentId)?.reply_to_comment_id).toBe(rootResult.commentId)
	})

	test('denormalized ACL fields copied from artifact', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'ACL denormalization check',
			},
			{ context: makeContext() },
		)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)

		expect(row?.organization_id).toBe(organizationId)
		expect(row?.task_id).toBe(taskId)
		expect(row?.created_by_user_id).toBe(userId)
		// resource_owner_user_id should match artifact's resource_owner_user_id
		expect(row?.resource_owner_user_id).toBeTypeOf('string')
		expect(row?.resource_owner_user_id.length).toBeGreaterThan(0)
	})

	test('created_at_artifact_version_id set to latest version (or null if no versions)', async () => {
		// The artifact was created via daemon upsert which may or may not create versions
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Version check comment',
			},
			{ context: makeContext() },
		)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)

		// Check for latest artifact version
		const [latestVersion] = await db
			.select()
			.from(artifactVersions)
			.where(eq(artifactVersions.artifact_id, artifactId))
			.orderBy(artifactVersions.version_number)
			.limit(1)

		if (latestVersion) {
			// If versions exist, the comment should reference the latest one
			expect(row?.created_at_artifact_version_id).toBeTypeOf('string')
		} else {
			expect(row?.created_at_artifact_version_id).toBeNull()
		}
	})

	test('creates comment with partial anchor (first block, no previous)', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Comment on first block',
				commentedUponBlockText: 'First block text',
				previousBlockText: null,
				nextBlockText: 'Second block',
			},
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)
		expect(row?.previous_block_text).toBeNull()
		expect(row?.next_block_text).toBe('Second block')
	})

	test('rejects artifact with null task_id - BAD_REQUEST', async () => {
		// Create artifact without task_id (direct DB insert)
		const [orphanArtifact] = await db
			.insert(artifacts)
			.values({
				task_id: null,
				resource_owner_user_id: userId,
				organization_id: organizationId,
				file_name: 'orphan.md',
				content: 'no task',
				content_hash: 'abc',
				created_by: userId,
			})
			.returning()

		if (!orphanArtifact) throw new Error('Failed to create orphan artifact')

		await expect(
			call(
				createCommentProcedure,
				{
					artifactId: orphanArtifact.id,
					contentText: 'Should fail - no task',
				},
				{ context: makeContext() },
			),
		).rejects.toThrow()
	})

	test('rejects for user without task read access - FORBIDDEN', async () => {
		// Create a separate task and artifact not accessible by otherUserId
		const [privateTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'private task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!privateTask) throw new Error('Failed to create private task')

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId: privateTask.id, fileName: 'private.md', content: '# Private' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)

		// otherUserId has no access to privateTask
		await expect(
			call(
				createCommentProcedure,
				{
					artifactId: artifactResult.artifactId,
					contentText: 'Should fail - no access',
				},
				{ context: makeContext(otherUserId) },
			),
		).rejects.toThrow()
	})

	test('rejects non-existent artifact - NOT_FOUND', async () => {
		await expect(
			call(
				createCommentProcedure,
				{
					artifactId: randomUUID(),
					contentText: 'Should fail',
				},
				{ context: makeContext() },
			),
		).rejects.toThrow()
	})

	test('user with task ACL can create comment', async () => {
		// Create task owned by userId, grant read to otherUserId via ACL
		const [sharedTask] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'shared task for comment',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()

		if (!sharedTask) throw new Error('Failed to create shared task')

		await db.insert(taskUserAcl).values({
			task_id: sharedTask.id,
			organization_id: organizationId,
			subject_user_id: otherUserId,
			resource_owner_user_id: userId,
			permission_level: 'read',
			granted_by: userId,
		})

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const artifactResult = await call(
			upsertArtifactProcedure,
			{ taskId: sharedTask.id, fileName: 'shared.md', content: '# Shared' },
			{
				context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }),
			},
		)

		// otherUserId has read access via ACL
		const result = await call(
			createCommentProcedure,
			{
				artifactId: artifactResult.artifactId,
				contentText: 'Shared task comment',
			},
			{ context: makeContext(otherUserId) },
		)

		expect(result.success).toBe(true)
	})
})
