import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { AnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { createCollection } from '@tanstack/db'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
	createMobileArtifactCommentV2Actions,
	createMobileV2ReplyRow,
	createMobileV2RootRow,
} from './mobile-artifact-comment-v2-actions'

const identity = {
	artifactId: 'artifact-1',
	organizationId: 'org-1',
	resourceOwnerUserId: 'owner-1',
	taskId: 'task-1',
	createdByUserId: 'user-1',
}

const anchor: AnchorV2 = {
	v: 2,
	scope: 'block',
	selectedText: 'Review this block',
	start: {
		blockType: 'paragraph',
		blockText: 'Review this block',
		previousBlockText: null,
		nextBlockText: 'Next block',
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Review this block',
		previousBlockText: null,
		nextBlockText: 'Next block',
		offset: 17,
	},
}

let collectionNumber = 0

function createTestCollection() {
	return createCollection<ArtifactComment>({
		id: `mobile-v2-actions-${collectionNumber++}`,
		getKey: (row) => row.id,
		startSync: true,
		sync: {
			sync: ({ begin, commit, markReady }) => {
				begin()
				commit()
				markReady()
			},
		},
	})
}

function apiCreate(create: (input: unknown) => Promise<{ transactionId: string }>) {
	return { comments: { create } }
}

afterEach(() => vi.restoreAllMocks())

describe('mobile V2 optimistic comment rows', () => {
	test('creates a V2 root without legacy anchors or content JSON', () => {
		vi.spyOn(Date, 'now').mockReturnValue(123)
		const row = createMobileV2RootRow({
			...identity,
			id: 'root-1',
			contentText: 'Please revise this.',
			anchorJson: anchor,
		})

		expect(row).toEqual({
			id: 'root-1',
			artifact_id: 'artifact-1',
			content_text: 'Please revise this.',
			content_json: null,
			anchor_json: anchor,
			kind: 'comment',
			commented_upon_block_text: null,
			previous_block_text: null,
			next_block_text: null,
			reply_to_comment_id: null,
			is_resolved: false,
			is_deleted: false,
			created_at: 123n,
			updated_at: 123n,
			organization_id: 'org-1',
			resource_owner_user_id: 'owner-1',
			task_id: 'task-1',
			...userAuthoredCommentColumns('user-1'),
			created_at_artifact_version_id: null,
			resolved_by_user_id: null,
			created_by_agent: false,
		})
	})

	test('inserts before persistence, sends the V2 API input, and confirms the transaction', async () => {
		const collection = createTestCollection()
		const order: string[] = []
		const create = vi.fn(async (input: unknown) => {
			order.push('persist')
			expect(collection.get('root-1')).toMatchObject({ anchor_json: anchor, content_json: null })
			return { transactionId: 'tx-1' }
		})
		const confirm = vi.fn(async (transactionId: string) => {
			order.push(`confirm:${transactionId}`)
		})
		const actions = createMobileArtifactCommentV2Actions(collection as never, apiCreate(create) as never, confirm)

		const persisted = actions.createRoot({
			...identity,
			id: 'root-1',
			contentText: 'Please revise this.',
			anchorJson: anchor,
		})
		order.push('returned')

		expect(collection.get('root-1')).toMatchObject({
			anchor_json: anchor,
			content_json: null,
			commented_upon_block_text: null,
			previous_block_text: null,
			next_block_text: null,
		})
		await persisted
		expect(create).toHaveBeenCalledWith({
			id: 'root-1',
			artifactId: 'artifact-1',
			contentText: 'Please revise this.',
			anchorJson: anchor,
			kind: 'comment',
		})
		expect(confirm).toHaveBeenCalledWith('tx-1')
		expect(order).toEqual(['persist', 'returned', 'confirm:tx-1'])
	})

	test('rolls back the optimistic root when persistence fails', async () => {
		const collection = createTestCollection()
		const actions = createMobileArtifactCommentV2Actions(
			collection as never,
			apiCreate(async () => {
				throw new Error('offline')
			}) as never,
			vi.fn(),
		)

		const persisted = actions.createRoot({
			...identity,
			id: 'root-1',
			contentText: 'Please revise this.',
			anchorJson: anchor,
		})
		expect(collection.get('root-1')).toBeDefined()

		await expect(persisted).rejects.toThrow('offline')
		expect(collection.get('root-1')).toBeUndefined()
	})

	test('creates a text-only reply that inherits context from its V2 root', () => {
		const row = createMobileV2ReplyRow({
			...identity,
			id: 'reply-1',
			rootCommentId: 'root-1',
			contentText: 'Done.',
		})

		expect(row).toMatchObject({
			id: 'reply-1',
			content_text: 'Done.',
			content_json: null,
			anchor_json: null,
			kind: 'comment',
			reply_to_comment_id: 'root-1',
		})
	})
})
