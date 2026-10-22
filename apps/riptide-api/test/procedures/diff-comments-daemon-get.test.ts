import { call } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'
import { createDaemonDiffCommentsTestHarness } from './diff-comments-daemon-test-harness'

await requireExternalTestServices()

describe('daemon/diff-comments/get', () => {
	let harness: Awaited<ReturnType<typeof createDaemonDiffCommentsTestHarness>>

	beforeAll(async () => {
		harness = await createDaemonDiffCommentsTestHarness('diff_comments_daemon_get')
	}, 60_000)

	afterAll(async () => {
		await harness.cleanup()
	}, 30_000)

	test('returns ordered full threads, anchors, exact short IDs, and resolved filtering', async () => {
		const firstRootId = await harness.insertComment({ contentText: 'First root', order: 10 })
		const secondRootId = await harness.insertComment({ contentText: 'Resolved root', isResolved: true, order: 20 })
		const replyId = await harness.insertComment({
			replyToCommentId: firstRootId,
			contentText: 'First reply',
			createdByAgent: true,
			order: 30,
		})

		const open = await call(
			harness.procedures.get,
			{ taskId: harness.taskIds[0], includeResolved: false },
			{ context: harness.context() },
		)
		expect(open.comments).toHaveLength(1)
		expect(open.comments[0]).toMatchObject({
			root: { id: firstRootId, truncatedId: firstRootId.slice(-12), contentText: 'First root' },
			replies: [{ id: replyId, truncatedId: replyId.slice(-12), createdByAgent: true }],
			anchor: {
				repoId: 'repo-daemon-test',
				path: 'src/daemon-test.ts',
				start: { side: 'old', line: 4 },
				end: { side: 'new', line: 8 },
			},
			isResolved: false,
		})

		const all = await call(
			harness.procedures.get,
			{ taskId: harness.taskIds[0], includeResolved: true },
			{ context: harness.context() },
		)
		expect(all.comments.map((thread) => thread.root.id)).toEqual([firstRootId, secondRootId])
	})

	test('does not leak comments across task or organization scope', async () => {
		const primaryId = await harness.insertComment({ contentText: 'Primary task', order: 40 })
		await harness.insertComment({ taskIndex: 1, contentText: 'Sibling task', order: 1 })
		await harness.insertComment({ taskIndex: 2, contentText: 'Foreign task', order: 1 })

		const result = await call(
			harness.procedures.get,
			{ taskId: harness.taskIds[0], includeResolved: true },
			{ context: harness.context() },
		)
		expect(result.comments.some((thread) => thread.root.id === primaryId)).toBe(true)
		expect(
			result.comments.flatMap((thread) => [
				thread.root.contentText,
				...thread.replies.map((reply) => reply.contentText),
			]),
		).not.toContain('Sibling task')
		expect(
			result.comments.flatMap((thread) => [
				thread.root.contentText,
				...thread.replies.map((reply) => reply.contentText),
			]),
		).not.toContain('Foreign task')

		await expect(
			call(
				harness.procedures.get,
				{ taskId: harness.taskIds[2], includeResolved: true },
				{ context: harness.context(0) },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})
})
