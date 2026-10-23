import { describe, it } from '@effect/vitest'
import { diffComments as diffCommentRows } from '@humanlayer/db/tables/diff-comments'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { DiffComments } from '../../src/effects/services/diff-comments/diff-comments'
import { DiffCommentsLive } from '../../src/effects/services/diff-comments/diff-comments-live'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('DiffComments', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string
	const userId = 'diff-comments-effect-user'

	beforeAll(async () => {
		const testDb = await createTestDb('diff_comments_effect')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Diff Comments Effect Tests', workos_organization_id: 'workos-diff-comments-effect' })
			.returning()
		if (!organization) throw new Error('Failed to seed organization')
		organizationId = organization.id
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Diff comments effect task',
				created_by: userId,
				resource_owner_user_id: userId,
			})
			.returning()
		if (!task) throw new Error('Failed to seed task')
		taskId = task.id
	}, 60_000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30_000)

	const makeLayer = () => Layer.provideMerge(DiffCommentsLive, PostgresDbLive(db))

	it.effect('creates a root and normalizes replies to it', () =>
		Effect.gen(function* () {
			const diffComments = yield* DiffComments
			const userInfo = { organizationId, userId, createdByAgent: false }
			const root = yield* diffComments.create({
				taskId,
				contentText: 'Root feedback',
				anchor: {
					v: 1,
					repoId: 'repo-1',
					path: 'src/example.ts',
					patchHash: 'patch-hash',
					start: { side: 'new', line: 3 },
					end: { side: 'new', line: 3 },
				},
				userInfo,
			})
			const reply = yield* diffComments.reply({
				taskId,
				rootCommentId: root.commentId,
				contentText: 'Reply feedback',
				userInfo,
			})
			const rows = yield* Effect.promise(() =>
				db.select().from(diffCommentRows).where(eq(diffCommentRows.task_id, taskId)),
			)
			expect(root.transactionId).toMatch(/^\d+$/)
			expect(reply.transactionId).toMatch(/^\d+$/)
			expect(rows).toHaveLength(2)
			expect(rows.find((row) => row.id === reply.commentId)?.reply_to_comment_id).toBe(root.commentId)
		}).pipe(Effect.provide(makeLayer())),
	)
})
