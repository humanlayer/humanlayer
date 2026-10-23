import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, it } from 'vitest'

import type { AnchorV2 } from '../anchor/types'
import { createV2CommentPersistence, type CreateV2CommentInput } from './optimistic-create'

describe('V2 optimistic comment persistence', () => {
	it('preserves V2 row invariants and confirms only after persistence', async () => {
		const calls: string[] = []
		let row: ArtifactComment | null = null
		const persistence = createV2CommentPersistence({
			insert: (value) => {
				calls.push('insert')
				row = value
			},
			persist: async () => {
				calls.push('persist')
				return { transactionId: 'tx-1' }
			},
			confirm: async (transactionId) => {
				calls.push(`confirm:${transactionId}`)
			},
			now: () => 123,
		})
		const anchor = { version: 2 } as unknown as AnchorV2
		const input: CreateV2CommentInput = {
			id: 'comment-1', artifactId: 'artifact-1', contentText: 'Review', anchorJson: anchor, kind: 'comment',
			organizationId: 'org-1', resourceOwnerUserId: 'owner-1', taskId: 'task-1', createdByUserId: 'user-1',
		}
		persistence.optimisticallyInsert(input)
		await persistence.persistAndConfirm(input)
		expect(calls).toEqual(['insert', 'persist', 'confirm:tx-1'])
		expect(row).toMatchObject({
			anchor_json: anchor,
			kind: 'comment',
			commented_upon_block_text: null,
			previous_block_text: null,
			next_block_text: null,
			reply_to_comment_id: null,
			created_at: 123n,
			updated_at: 123n,
		})
	})

	it('carries a typed verdict kind through the same single row-construction path', async () => {
		let row: ArtifactComment | null = null
		let persistedKind: string | undefined
		const persistence = createV2CommentPersistence({
			insert: (value) => {
				row = value
			},
			persist: async (input) => {
				persistedKind = input.kind
				return { transactionId: 'tx-2' }
			},
			confirm: async () => {},
			now: () => 456,
		})
		const anchor = { version: 2 } as unknown as AnchorV2
		const input: CreateV2CommentInput = {
			id: 'verdict-1', artifactId: 'artifact-1', contentText: 'Delete this', anchorJson: anchor, kind: 'deletion',
			organizationId: 'org-1', resourceOwnerUserId: 'owner-1', taskId: 'task-1', createdByUserId: 'user-1',
		}
		persistence.optimisticallyInsert(input)
		await persistence.persistAndConfirm(input)
		expect(row).toMatchObject({
			kind: 'deletion',
			content_text: 'Delete this',
			// Verdicts leave the legacy triplet null just like normal V2 comments.
			commented_upon_block_text: null,
			previous_block_text: null,
			next_block_text: null,
		})
		expect(persistedKind).toBe('deletion')
	})
})
