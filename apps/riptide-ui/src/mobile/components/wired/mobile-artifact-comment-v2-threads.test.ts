import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { AnchorV2, ProjectedCommentThread } from '@humanlayer/ui/artifact-viewer-v2'
import { describe, expect, test } from 'vitest'

import { toMobileArtifactCommentV2Thread } from './mobile-artifact-comment-v2-threads'

function comment(id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return {
		id,
		organization_id: 'org',
		resource_owner_user_id: 'owner',
		task_id: 'task',
		created_by_user_id: 'user',
		reply_to_comment_id: null,
		created_at: 100n,
		updated_at: 100n,
		content_text: id,
		content_json: null,
		artifact_id: 'artifact',
		created_at_artifact_version_id: null,
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		anchor_json: null,
		kind: 'comment',
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
		...overrides,
	}
}

const textAnchor: AnchorV2 = {
	v: 2,
	scope: 'block',
	selectedText: 'Second paragraph',
	start: {
		blockType: 'paragraph',
		blockText: 'Second paragraph',
		previousBlockText: 'First paragraph',
		nextBlockText: null,
		offset: 0,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Second paragraph',
		previousBlockText: 'First paragraph',
		nextBlockText: null,
		offset: 16,
	},
}

function projected(root: ArtifactComment, reply: ArtifactComment): ProjectedCommentThread {
	return {
		root,
		replies: [
			{
				id: reply.id,
				contentText: reply.content_text,
				contentJson: reply.content_json,
				createdAt: reply.created_at,
				createdByUserId: reply.created_by_user_id,
				createdByAgent: reply.created_by_agent,
				authorName: 'User',
				authorAvatarUrl: null,
			},
		],
		authorName: 'User',
		authorAvatarUrl: null,
		participants: [],
		placement: { status: 'resolved', from: 4, to: 22 },
	}
}

describe('mobile V2 thread adapter', () => {
	test('uses the V2 quote and preserves projected reply order', () => {
		const root = comment('root', { anchor_json: textAnchor })
		const reply = comment('nested-reply', { reply_to_comment_id: 'older-reply' })
		const thread = toMobileArtifactCommentV2Thread(projected(root, reply), new Map([[reply.id, reply]]))

		expect(thread.anchorText).toBe('Second paragraph')
		expect(thread.replies.map((row) => row.id)).toEqual(['nested-reply'])
		expect(thread.placement).toEqual({ status: 'resolved', from: 4, to: 22 })
		expect(thread.isResolved).toBe(false)
		expect(thread.isOutdated).toBe(false)
	})

	test('uses the selected quote for desktop-created range anchors', () => {
		const rangeAnchor: AnchorV2 = {
			...textAnchor,
			scope: 'range',
			selectedText: 'paragraph',
			start: { ...textAnchor.start, offset: 7 },
			end: { ...textAnchor.end, offset: 16 },
		}
		const reply = comment('reply')
		const thread = toMobileArtifactCommentV2Thread(
			projected(comment('range', { anchor_json: rangeAnchor, is_resolved: true }), reply),
			new Map(),
		)

		expect(thread.anchorText).toBe('paragraph')
		expect(thread.isResolved).toBe(true)
	})

	test('labels empty atom anchors and malformed anchors without legacy fallback', () => {
		const atomAnchor: AnchorV2 = {
			...textAnchor,
			selectedText: '',
			start: { ...textAnchor.start, blockType: 'image', blockText: '', offset: 0 },
			end: { ...textAnchor.end, blockType: 'image', blockText: '', offset: 0 },
		}
		const reply = comment('reply')
		const atom = toMobileArtifactCommentV2Thread(
			projected(comment('atom', { anchor_json: atomAnchor }), reply),
			new Map(),
		)
		const malformedProjection = projected(comment('bad', { anchor_json: { v: 2 } }), reply)
		malformedProjection.placement = { status: 'outdated' }
		const malformed = toMobileArtifactCommentV2Thread(malformedProjection, new Map())

		expect(atom.anchorText).toBe('[image]')
		expect(malformed.anchorText).toBe('Unknown section')
		expect(malformed.placement).toEqual({ status: 'outdated' })
		expect(malformed.isOutdated).toBe(true)
	})
})
