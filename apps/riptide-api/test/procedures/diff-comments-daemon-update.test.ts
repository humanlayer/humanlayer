import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'
import { createDaemonDiffCommentsTestHarness } from './diff-comments-daemon-test-harness'

await requireExternalTestServices()

describe('daemon/diff-comments/update', () => {
	let harness: Awaited<ReturnType<typeof createDaemonDiffCommentsTestHarness>>

	beforeAll(async () => {
		harness = await createDaemonDiffCommentsTestHarness('diff_comments_daemon_update')
	}, 60_000)

	afterAll(async () => {
		await harness.cleanup()
	}, 30_000)

	test('resolves and reopens the shared root when given a reply suffix', async () => {
		const rootId = await harness.insertComment({ order: 1 })
		const replyId = await harness.insertComment({ replyToCommentId: rootId, order: 2 })

		await call(
			harness.procedures.update,
			{ taskId: harness.taskIds[0], truncatedCommentIds: [replyId.slice(-8)], resolved: true },
			{ context: harness.context(0, 'driver-1') },
		)
		let rows = await harness.db.select().from(diffComments).where(eq(diffComments.task_id, harness.taskIds[0]))
		expect(rows.find((row) => row.id === rootId)).toMatchObject({
			is_resolved: true,
			resolved_by_user_id: 'driver-1',
		})
		expect(rows.find((row) => row.id === replyId)?.is_resolved).toBe(false)

		await call(
			harness.procedures.update,
			{ taskId: harness.taskIds[0], truncatedCommentIds: [rootId.slice(-12)], resolved: false },
			{ context: harness.context(0, 'driver-1') },
		)
		rows = await harness.db.select().from(diffComments).where(eq(diffComments.task_id, harness.taskIds[0]))
		expect(rows.find((row) => row.id === rootId)).toMatchObject({ is_resolved: false, resolved_by_user_id: null })
	})

	test('tombstones only rows authored by the driving user and retains content', async () => {
		const ownId = await harness.insertComment({ createdByUserId: 'driver-1', contentText: 'Own row', order: 10 })
		const otherId = await harness.insertComment({
			createdByUserId: 'other-user',
			contentText: 'Other row',
			order: 11,
		})
		const result = await call(
			harness.procedures.update,
			{
				taskId: harness.taskIds[0],
				truncatedCommentIds: [ownId.slice(-12), otherId.slice(-12)],
				deleted: true,
			},
			{ context: harness.context(0, 'driver-1') },
		)

		expect(result.updated).toEqual([{ truncatedId: ownId.slice(-12), commentId: ownId }])
		expect(result.failed).toEqual([{ truncatedId: otherId.slice(-12), reason: 'forbidden' }])
		const rows = await harness.db.select().from(diffComments).where(eq(diffComments.task_id, harness.taskIds[0]))
		expect(rows.find((row) => row.id === ownId)).toMatchObject({
			is_deleted: true,
			content_text: 'Own row',
			content_json: null,
		})
		expect(rows.find((row) => row.id === otherId)).toMatchObject({ is_deleted: false, content_text: 'Other row' })
	})

	test('reports not-found and ambiguous suffixes distinctly and does not cross task scope', async () => {
		const sharedSuffix = 'bbbbbbbbbbbb'
		await harness.insertComment({ id: `33333333-3333-4333-8333-${sharedSuffix}`, order: 20 })
		await harness.insertComment({ id: `44444444-4444-4444-8444-${sharedSuffix}`, order: 21 })
		const siblingId = await harness.insertComment({ taskIndex: 1, createdByUserId: 'driver-1', order: 1 })
		const result = await call(
			harness.procedures.update,
			{
				taskId: harness.taskIds[0],
				truncatedCommentIds: [sharedSuffix.slice(-8), siblingId.slice(-12)],
				resolved: true,
			},
			{ context: harness.context() },
		)

		expect(result.updated).toEqual([])
		expect(result.failed).toEqual([
			{ truncatedId: sharedSuffix.slice(-8), reason: 'ambiguous' },
			{ truncatedId: siblingId.slice(-12), reason: 'not_found' },
		])

		await expect(
			call(
				harness.procedures.update,
				{ taskId: harness.taskIds[2], truncatedCommentIds: [siblingId.slice(-12)], resolved: true },
				{ context: harness.context(0) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
