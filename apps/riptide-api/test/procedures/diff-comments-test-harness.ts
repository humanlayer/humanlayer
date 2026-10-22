import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'

import { createDiffCommentProcedure as liveCreate } from '../../src/orpc/api/diff-comments/create.effect'
import { deleteDiffCommentProcedure as liveDelete } from '../../src/orpc/api/diff-comments/delete.effect'
import { editDiffCommentProcedure as liveEdit } from '../../src/orpc/api/diff-comments/edit.effect'
import { replyDiffCommentProcedure as liveReply } from '../../src/orpc/api/diff-comments/reply.effect'
import { resolveBatchDiffCommentsProcedure as liveResolveBatch } from '../../src/orpc/api/diff-comments/resolve-batch.effect'
import { resolveDiffCommentProcedure as liveResolve } from '../../src/orpc/api/diff-comments/resolve.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { createTestDb } from '../utils/test-db'

export const testAnchor = {
	v: 1 as const,
	repoId: 'repo-1',
	path: 'src/example.ts',
	patchHash: 'patch-1',
	start: { side: 'old' as const, line: 2 },
	end: { side: 'new' as const, line: 4 },
}

export async function createDiffCommentsTestHarness(name: string) {
	const testDb = await createTestDb(name)
	const runtime = createRuntimeWithTestPostgresLayer(testDb.db)
	const organizationIds: [string, string] = [randomUUID(), randomUUID()]
	await testDb.db.insert(organizations).values([
		{ id: organizationIds[0], name: `${name} org one`, workos_organization_id: `${name}_one` },
		{ id: organizationIds[1], name: `${name} org two`, workos_organization_id: `${name}_two` },
	])
	const taskIds: [string, string] = [randomUUID(), randomUUID()]
	await testDb.db.insert(tasks).values([
		{
			id: taskIds[0],
			organization_id: organizationIds[0],
			name: `${name} task one`,
			resource_owner_user_id: 'owner-1',
			created_by: 'owner-1',
		},
		{
			id: taskIds[1],
			organization_id: organizationIds[1],
			name: `${name} task two`,
			resource_owner_user_id: 'owner-2',
			created_by: 'owner-2',
		},
	])

	const context = (organizationIndex = 0, userId = 'author-1') =>
		createMockApiContext({
			auth: createMockApiAuth({
				userId,
				organizationId: organizationIds[organizationIndex]!,
				workosOrganizationId: `${name}_${organizationIndex}`,
			}),
			services: { db: testDb.db, dbReadReplica: testDb.db },
		})

	const procedures = {
		create: bindProcedureToRuntime(liveCreate, runtime),
		reply: bindProcedureToRuntime(liveReply, runtime),
		edit: bindProcedureToRuntime(liveEdit, runtime),
		delete: bindProcedureToRuntime(liveDelete, runtime),
		resolve: bindProcedureToRuntime(liveResolve, runtime),
		resolveBatch: bindProcedureToRuntime(liveResolveBatch, runtime),
	}

	const createRoot = async (userId = 'author-1') =>
		call(
			procedures.create,
			{ taskId: taskIds[0], contentText: 'Root comment', anchor: testAnchor },
			{ context: context(0, userId) },
		)

	return {
		db: testDb.db,
		organizationIds,
		taskIds,
		context,
		procedures,
		createRoot,
		cleanup: async () => {
			await runtime.dispose()
			await testDb.cleanup()
		},
	}
}
