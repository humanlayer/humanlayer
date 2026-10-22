import { randomUUID } from 'node:crypto'

import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'

import { getDiffCommentsProcedure as liveGet } from '../../src/orpc/daemon/diff-comments/get.effect'
import { replyToDiffCommentProcedure as liveReply } from '../../src/orpc/daemon/diff-comments/reply.effect'
import { updateDiffCommentsProcedure as liveUpdate } from '../../src/orpc/daemon/diff-comments/update.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { createTestDb } from '../utils/test-db'

export const daemonTestAnchor = {
	v: 1 as const,
	repoId: 'repo-daemon-test',
	path: 'src/daemon-test.ts',
	patchHash: 'daemon-test-patch',
	start: { side: 'old' as const, line: 4 },
	end: { side: 'new' as const, line: 8 },
}

export async function createDaemonDiffCommentsTestHarness(name: string) {
	const testDb = await createTestDb(name)
	const runtime = createRuntimeWithTestPostgresLayer(testDb.db)
	const organizationIds: [string, string] = [randomUUID(), randomUUID()]
	await testDb.db.insert(organizations).values([
		{ id: organizationIds[0], name: `${name} org one`, workos_organization_id: `${name}_one` },
		{ id: organizationIds[1], name: `${name} org two`, workos_organization_id: `${name}_two` },
	])
	const taskIds: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()]
	await testDb.db.insert(tasks).values([
		{
			id: taskIds[0],
			organization_id: organizationIds[0],
			name: `${name} primary task`,
			resource_owner_user_id: 'owner-1',
			created_by: 'owner-1',
		},
		{
			id: taskIds[1],
			organization_id: organizationIds[0],
			name: `${name} sibling task`,
			resource_owner_user_id: 'owner-1',
			created_by: 'owner-1',
		},
		{
			id: taskIds[2],
			organization_id: organizationIds[1],
			name: `${name} foreign task`,
			resource_owner_user_id: 'owner-2',
			created_by: 'owner-2',
		},
	])

	const context = (organizationIndex: 0 | 1 = 0, userId = 'driver-1') =>
		createMockDaemonContext({
			auth: createMockDaemonAuth({
				userId,
				organizationId: organizationIds[organizationIndex],
				hostId: randomUUID(),
			}),
			services: { db: testDb.db, dbReadReplica: testDb.db },
		})

	const insertComment = async (input: {
		readonly taskIndex?: 0 | 1 | 2
		readonly id?: string
		readonly replyToCommentId?: string | null
		readonly contentText?: string
		readonly createdByUserId?: string
		readonly createdByAgent?: boolean
		readonly isResolved?: boolean
		readonly isDeleted?: boolean
		readonly order?: number
	}) => {
		const taskIndex = input.taskIndex ?? 0
		const organizationIndex = taskIndex === 2 ? 1 : 0
		const id = input.id ?? randomUUID()
		const timestamp = BigInt(1_800_000_000_000 + (input.order ?? 0))
		await testDb.db.insert(diffComments).values({
			id,
			organization_id: organizationIds[organizationIndex],
			resource_owner_user_id: organizationIndex === 0 ? 'owner-1' : 'owner-2',
			task_id: taskIds[taskIndex],
			created_by_user_id: input.createdByUserId ?? 'author-1',
			reply_to_comment_id: input.replyToCommentId ?? null,
			content_text: input.contentText ?? 'Comment body',
			content_json: null,
			anchor_json: input.replyToCommentId ? null : daemonTestAnchor,
			is_resolved: input.isResolved ?? false,
			resolved_by_user_id: input.isResolved ? 'resolver-1' : null,
			is_deleted: input.isDeleted ?? false,
			created_by_agent: input.createdByAgent ?? false,
			created_at: timestamp,
			updated_at: timestamp,
		})
		return id
	}

	return {
		db: testDb.db,
		organizationIds,
		taskIds,
		context,
		insertComment,
		procedures: {
			get: bindProcedureToRuntime(liveGet, runtime),
			reply: bindProcedureToRuntime(liveReply, runtime),
			update: bindProcedureToRuntime(liveUpdate, runtime),
		},
		cleanup: async () => {
			await runtime.dispose()
			await testDb.cleanup()
		},
	}
}
