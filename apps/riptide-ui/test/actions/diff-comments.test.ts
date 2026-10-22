import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import { createCollection } from '@tanstack/db'
import { uuidv7 } from 'uuidv7'
import { describe, expect, test, vi } from 'vitest'

import { createDiffCommentActions } from '@/actions/diff-comments'

type SyncWrite = { type: 'insert' | 'update'; value: DiffComment }

function createTestCollection(rows: readonly DiffComment[] = []) {
	let controls: { begin: () => void; write: (message: SyncWrite) => void; commit: () => void } | undefined
	const collection = createCollection<DiffComment>({
		id: `test-diff-comments-${uuidv7()}`,
		getKey: (row) => row.id,
		startSync: true,
		sync: {
			sync: ({ begin, write, commit, markReady }) => {
				controls = { begin, write, commit }
				begin()
				for (const row of rows) write({ type: 'insert', value: row })
				commit()
				markReady()
			},
		},
	})
	const deliver = (message: SyncWrite) => {
		if (!controls) throw new Error('Sync not started')
		controls.begin()
		controls.write(message)
		controls.commit()
	}
	return { collection, deliver }
}

function row(overrides: Partial<DiffComment> = {}): DiffComment {
	return {
		id: uuidv7(),
		organization_id: uuidv7(),
		resource_owner_user_id: 'owner-1',
		task_id: uuidv7(),
		created_by_user_id: 'author-1',
		reply_to_comment_id: null,
		created_at: 1n,
		updated_at: 1n,
		content_text: 'Original',
		content_json: null,
		anchor_json: {
			v: 1,
			repoId: 'repo-1',
			path: 'a.ts',
			patchHash: 'patch-1',
			start: { side: 'new', line: 1 },
			end: { side: 'new', line: 1 },
		},
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

function api(overrides: Record<string, unknown> = {}) {
	const success = async () => ({ success: true as const, transactionId: '42' })
	return {
		diffComments: {
			create: async () => ({ ...(await success()), commentId: uuidv7() }),
			reply: async () => ({ ...(await success()), commentId: uuidv7() }),
			edit: success,
			delete: success,
			resolve: success,
			resolveBatch: async () => ({ ...(await success()), resolvedCount: 1 }),
			...overrides,
		},
	}
}

describe('diff comment optimistic actions', () => {
	test('inserts a canonical root and waits for sync confirmation', async () => {
		const { collection, deliver } = createTestCollection()
		const id = uuidv7()
		const synced = row({ id })
		const confirmTx = vi.fn(async () => deliver({ type: 'insert', value: synced }))
		const actions = createDiffCommentActions(collection as never, api() as never, confirmTx)
		const transaction = actions.create({
			id,
			taskId: synced.task_id,
			organizationId: synced.organization_id,
			resourceOwnerUserId: synced.resource_owner_user_id,
			createdByUserId: synced.created_by_user_id,
			contentText: synced.content_text,
			anchor: synced.anchor_json!,
		})

		expect(collection.get(id)).toMatchObject({ reply_to_comment_id: null, anchor_json: synced.anchor_json })
		await transaction.isPersisted.promise
		expect(confirmTx).toHaveBeenCalledWith('42')
	})

	test('sends the anchor left-side sourceVersionId and selected diff to the API', async () => {
		const { collection } = createTestCollection()
		const create = vi.fn(async () => ({ success: true as const, transactionId: '42', commentId: uuidv7() }))
		const actions = createDiffCommentActions(collection as never, api({ create }) as never, async () => {})
		const base = row()
		const anchor = {
			...base.anchor_json!,
			start: { side: 'old' as const, line: 1 },
			sourceVersionId: 'repo-1:a.ts:b',
			selectedDiff: '-old\n+new',
		}
		const transaction = actions.create({
			id: base.id,
			taskId: base.task_id,
			organizationId: base.organization_id,
			resourceOwnerUserId: base.resource_owner_user_id,
			createdByUserId: base.created_by_user_id,
			contentText: 'On B',
			anchor,
		})

		expect(collection.get(base.id)?.anchor_json).toEqual(anchor)
		await transaction.isPersisted.promise
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ anchor }))
	})

	test('rolls an edit back when persistence fails', async () => {
		const original = row()
		const { collection } = createTestCollection([original])
		const actions = createDiffCommentActions(
			collection as never,
			api({
				edit: async () => {
					throw new Error('offline')
				},
			}) as never,
			async () => {},
		)
		const transaction = actions.edit({ commentId: original.id, contentText: 'Changed' })

		expect(collection.get(original.id)?.content_text).toBe('Changed')
		await expect(transaction.isPersisted.promise).rejects.toThrow('offline')
		expect(collection.get(original.id)?.content_text).toBe('Original')
	})

	test('updates delete, resolution, reply reopen, and exact batch state', async () => {
		const root = row({ is_resolved: true, resolved_by_user_id: 'resolver-1' })
		const second = row({ task_id: root.task_id, organization_id: root.organization_id })
		const { collection } = createTestCollection([root, second])
		const actions = createDiffCommentActions(collection as never, api() as never, async () => {})
		const replyId = uuidv7()
		const identity = {
			organizationId: root.organization_id,
			resourceOwnerUserId: root.resource_owner_user_id,
			createdByUserId: 'reader-1',
		}

		actions.reply({ id: replyId, taskId: root.task_id, rootCommentId: root.id, contentText: 'Reply', ...identity })
		expect(collection.get(root.id)?.is_resolved).toBe(false)
		expect(collection.get(replyId)).toMatchObject({ reply_to_comment_id: root.id, anchor_json: null })
		actions.remove({ commentId: replyId })
		expect(collection.get(replyId)).toMatchObject({ is_deleted: true, content_text: 'Reply' })
		actions.resolve({ commentId: root.id, isResolved: true, resolvedByUserId: 'reader-1' })
		expect(collection.get(root.id)?.resolved_by_user_id).toBe('reader-1')
		actions.resolveBatch({
			taskId: root.task_id,
			rootCommentIds: [root.id, second.id],
			resolvedByUserId: 'reader-1',
		})
		expect(collection.get(second.id)?.is_resolved).toBe(true)
	})
})
