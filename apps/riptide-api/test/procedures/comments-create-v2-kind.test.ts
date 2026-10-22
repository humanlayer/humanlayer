import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const wholeBlockAnchor = {
	v: 2 as const,
	scope: 'block' as const,
	selectedText: 'Line 1',
	start: {
		blockType: 'paragraph',
		blockText: 'Line 1',
		previousBlockText: 'Hello',
		nextBlockText: 'Line 2',
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Line 1',
		previousBlockText: 'Hello',
		nextBlockText: 'Line 2',
		offset: 'Line 1'.length,
	},
}

const rangeAnchor = {
	v: 2 as const,
	scope: 'range' as const,
	selectedText: 'Line',
	start: {
		blockType: 'paragraph',
		blockText: 'Line 1',
		previousBlockText: 'Hello',
		nextBlockText: 'Line 2',
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Line 1',
		previousBlockText: 'Hello',
		nextBlockText: 'Line 2',
		offset: 'Line'.length,
	},
}

describe('api/comments/create — V2 typed kind persistence', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_v2_kind'
	const userId = 'user_comments_v2_kind'
	const otherUserId = 'user_comments_v2_kind_other'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_create_v2_kind')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'v2 kind test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'v2 kind test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const createArtifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'v2-kind-doc.md', content: '# Hello\n\nLine 1\n\nLine 2' },
			{ context: createMockDaemonContext({ auth: daemonAuth, services: { db, dbReadReplica: db } }) },
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

	async function readRow(commentId: string) {
		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId)).limit(1)
		return row
	}

	test('defaults to the comment kind when omitted', async () => {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'A normal comment', anchorJson: wholeBlockAnchor },
			{ context: makeContext() },
		)
		expect(result.success).toBe(true)
		const row = await readRow(result.commentId)
		expect(row?.kind).toBe('comment')
	})

	test('persists an instant deletion verdict at a whole-block anchor', async () => {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Delete this', anchorJson: wholeBlockAnchor, kind: 'deletion' },
			{ context: makeContext() },
		)
		const row = await readRow(result.commentId)
		expect(row?.kind).toBe('deletion')
		expect(row?.content_text).toBe('Delete this')
		expect(row?.anchor_json).toEqual(wholeBlockAnchor)
		// Verdicts never dual-write the legacy triplet.
		expect(row?.commented_upon_block_text).toBeNull()
		expect(row?.previous_block_text).toBeNull()
		expect(row?.next_block_text).toBeNull()
	})

	test('persists an instant approval verdict at a precise range anchor', async () => {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Looks good', anchorJson: rangeAnchor, kind: 'approval' },
			{ context: makeContext() },
		)
		const row = await readRow(result.commentId)
		expect(row?.kind).toBe('approval')
		expect(row?.content_text).toBe('Looks good')
		expect(row?.anchor_json).toEqual(rangeAnchor)
	})

	test('rejects an invalid kind (contract validation)', async () => {
		await expect(
			call(
				createCommentProcedure,
				{ artifactId, contentText: 'Bad kind', anchorJson: wholeBlockAnchor, kind: 'redline' as never },
				{ context: makeContext() },
			),
		).rejects.toThrow()
	})

	test('organization/task authorization applies to typed creates', async () => {
		await expect(
			call(
				createCommentProcedure,
				{ artifactId, contentText: 'Should fail - no access', anchorJson: wholeBlockAnchor, kind: 'deletion' },
				{ context: makeContext(otherUserId) },
			),
		).rejects.toThrow()
	})
})
