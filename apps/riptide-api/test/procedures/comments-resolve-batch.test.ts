import { randomUUID } from 'node:crypto'

import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createCommentProcedure } from '../../src/orpc/api/comments/create'
import { resolveBatchCommentsProcedure as liveResolveBatchCommentsProcedure } from '../../src/orpc/api/comments/resolve-batch.effect'
import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockApiAuth, createMockApiContext, createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const anchor = {
	v: 2 as const,
	scope: 'block' as const,
	selectedText: 'Block',
	start: {
		blockType: 'paragraph',
		blockText: 'Block',
		previousBlockText: null,
		nextBlockText: null,
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Block',
		previousBlockText: null,
		nextBlockText: null,
		offset: 5,
	},
}

describe('api/comments/resolve-batch', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let resolveBatchCommentsProcedure: typeof liveResolveBatchCommentsProcedure
	let organizationId: string
	let taskId: string
	let artifactId: string
	const workosOrganizationId = 'org_comments_resolve_batch'
	const userId = 'user_comments_resolve_batch'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('comments_resolve_batch')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		resolveBatchCommentsProcedure = bindProcedureToRuntime(liveResolveBatchCommentsProcedure, effectRuntime)
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'resolve batch org', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Unable to create organization')
		organizationId = organization.id
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'resolve batch task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to create task')
		taskId = task.id
		const result = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'batch.md', content: 'Block' },
			{
				context: createMockDaemonContext({
					auth: createMockDaemonAuth({ userId, organizationId, hostId }),
					services: { db, dbReadReplica: db },
				}),
			},
		)
		artifactId = result.artifactId
	}, 60000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	function context(uid = userId) {
		return createMockApiContext({
			auth: createMockApiAuth({ userId: uid, organizationId, workosOrganizationId }),
			services: { db, dbReadReplica: db },
		})
	}

	async function createRoot(contentText: string, v2 = true) {
		return call(
			createCommentProcedure,
			{ artifactId, contentText, ...(v2 ? { anchorJson: anchor } : {}) },
			{ context: context() },
		)
	}

	test('resolves exactly the requested V2 roots and all non-deleted replies', async () => {
		const first = await createRoot('first')
		const second = await createRoot('second')
		const unrequested = await createRoot('unrequested')
		const legacy = await createRoot('legacy', false)
		const reply = await call(
			createCommentProcedure,
			{ artifactId, contentText: 'reply', replyToCommentId: first.commentId },
			{ context: context() },
		)

		const result = await call(
			resolveBatchCommentsProcedure,
			{ artifactId, rootCommentIds: [first.commentId, second.commentId] },
			{ context: context() },
		)

		expect(result.success).toBe(true)
		expect(result.resolvedCount).toBe(3)
		const rows = await db
			.select({ id: artifactComments.id, isResolved: artifactComments.is_resolved })
			.from(artifactComments)
			.where(
				inArray(artifactComments.id, [
					first.commentId,
					second.commentId,
					reply.commentId,
					unrequested.commentId,
					legacy.commentId,
				]),
			)
		const state = new Map(rows.map((row) => [row.id, row.isResolved]))
		expect(state.get(first.commentId)).toBe(true)
		expect(state.get(second.commentId)).toBe(true)
		expect(state.get(reply.commentId)).toBe(true)
		expect(state.get(unrequested.commentId)).toBe(false)
		expect(state.get(legacy.commentId)).toBe(false)
	})

	test('rejects a mixed invalid batch atomically', async () => {
		const root = await createRoot('valid before invalid')
		await expect(
			call(
				resolveBatchCommentsProcedure,
				{ artifactId, rootCommentIds: [root.commentId, randomUUID()] },
				{ context: context() },
			),
		).rejects.toThrow()
		const [row] = await db
			.select({ isResolved: artifactComments.is_resolved })
			.from(artifactComments)
			.where(inArray(artifactComments.id, [root.commentId]))
		expect(row?.isResolved).toBe(false)
	})

	test('rejects callers without task access', async () => {
		const root = await createRoot('unauthorized')
		await expect(
			call(
				resolveBatchCommentsProcedure,
				{ artifactId, rootCommentIds: [root.commentId] },
				{ context: context('stranger') },
			),
		).rejects.toThrow()
	})
})
