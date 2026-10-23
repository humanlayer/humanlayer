import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { desc, eq } from 'drizzle-orm'
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

describe('api/comments/create — V2 anchor persistence', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase

	let organizationId: string
	const workosOrganizationId = 'org_comments_v2_anchor'
	const userId = 'user_comments_v2_anchor'
	const otherUserId = 'user_comments_v2_other'
	const hostId = randomUUID()

	let taskId: string
	let artifactId: string

	beforeAll(async () => {
		const testDb = await createTestDb('comments_create_v2_anchor')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'v2 anchor test org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'v2 anchor test task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id

		const daemonAuth = createMockDaemonAuth({ userId, organizationId, hostId })
		const createArtifactResult = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'v2-doc.md', content: '# Hello\n\nLine 1\n\nLine 2' },
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

	test('persists the whole-block anchor envelope verbatim with null legacy triplet columns', async () => {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'V2 whole-block comment', anchorJson: wholeBlockAnchor },
			{ context: makeContext() },
		)

		expect(result.success).toBe(true)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)

		expect(row?.anchor_json).toEqual(wholeBlockAnchor)
		// No dual-write: the legacy triplet stays exclusively legacy-controlled.
		expect(row?.commented_upon_block_text).toBeNull()
		expect(row?.previous_block_text).toBeNull()
		expect(row?.next_block_text).toBeNull()
		// Normal ACL/version capture still applies.
		expect(row?.organization_id).toBe(organizationId)
		expect(row?.task_id).toBe(taskId)
		expect(row?.created_by_user_id).toBe(userId)
	})

	test('captures the latest artifact version like legacy creates', async () => {
		const result = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'Version capture check', anchorJson: wholeBlockAnchor },
			{ context: makeContext() },
		)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)
		const [latestVersion] = await db
			.select()
			.from(artifactVersions)
			.where(eq(artifactVersions.artifact_id, artifactId))
			.orderBy(desc(artifactVersions.version_number))
			.limit(1)

		if (latestVersion) expect(row?.created_at_artifact_version_id).toBe(latestVersion.id)
		else expect(row?.created_at_artifact_version_id).toBeNull()
	})

	test('legacy callers that omit anchorJson persist a null anchor_json', async () => {
		const result = await call(
			createCommentProcedure,
			{
				artifactId,
				contentText: 'Legacy comment',
				commentedUponBlockText: 'Line 1',
				previousBlockText: 'Hello',
				nextBlockText: 'Line 2',
			},
			{ context: makeContext() },
		)

		const [row] = await db.select().from(artifactComments).where(eq(artifactComments.id, result.commentId)).limit(1)
		expect(row?.anchor_json).toBeNull()
		expect(row?.commented_upon_block_text).toBe('Line 1')
	})

	test('rejects malformed anchor envelopes (contract validation)', async () => {
		await expect(
			call(
				createCommentProcedure,
				{
					artifactId,
					contentText: 'Bad envelope',
					// Wrong version literal.
					anchorJson: { ...wholeBlockAnchor, v: 3 } as never,
				},
				{ context: makeContext() },
			),
		).rejects.toThrow()

		await expect(
			call(
				createCommentProcedure,
				{
					artifactId,
					contentText: 'Bad offsets',
					anchorJson: {
						...wholeBlockAnchor,
						end: { ...wholeBlockAnchor.end, offset: wholeBlockAnchor.end.blockText.length + 5 },
					},
				},
				{ context: makeContext() },
			),
		).rejects.toThrow()
	})

	test('organization/task authorization applies to anchored creates', async () => {
		// otherUserId has no access to the task that owns this artifact.
		await expect(
			call(
				createCommentProcedure,
				{ artifactId, contentText: 'Should fail - no access', anchorJson: wholeBlockAnchor },
				{ context: makeContext(otherUserId) },
			),
		).rejects.toThrow()
	})
})
