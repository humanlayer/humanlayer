import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { describe, expect, test } from 'vitest'

import type { AnchorV2, AnchorPlacement } from '../anchor/types'
import type { ProjectedCommentThread } from '../comments/project-comments'
import { exportFeedbackMarkdown, exportThreadFeedbackMarkdown } from './export-feedback'
import { commentRow } from '../test-utils/comment-row'

const rangeAnchor: AnchorV2 = {
	v: 2,
	scope: 'range',
	selectedText: 'exact selected text',
	start: {
		blockType: 'paragraph',
		blockText: 'Some exact selected text here.',
		previousBlockText: 'Before',
		nextBlockText: 'After',
		offset: 5,
	},
	end: {
		blockType: 'paragraph',
		blockText: 'Some exact selected text here.',
		previousBlockText: 'Before',
		nextBlockText: 'After',
		offset: 24,
	},
}

const blockAnchor: AnchorV2 = {
	...rangeAnchor,
	scope: 'block',
	selectedText: 'Whole block',
	start: { ...rangeAnchor.start, blockText: 'Whole block', offset: 0 },
	end: { ...rangeAnchor.end, blockText: 'Whole block', offset: 11 },
}

function root(id: string, overrides: Partial<ArtifactComment> = {}): ArtifactComment {
	return commentRow(id, {
		content_text: 'Please clarify this.',
		artifact_id: 'artifact-1',
		anchor_json: rangeAnchor,
		...overrides,
	})
}

function thread(
	id: string,
	overrides: Partial<ArtifactComment> = {},
	placement: AnchorPlacement = { status: 'resolved', from: 1, to: 5 },
): ProjectedCommentThread {
	return {
		root: root(id, overrides),
		replies: [],
		authorName: 'Ada',
		authorAvatarUrl: null,
		participants: [],
		placement,
	}
}

describe('exportFeedbackMarkdown', () => {
	test('formats open ranged, whole-block, verdict, outdated, and reply feedback in projection order', () => {
		const normal = thread('normal')
		normal.replies = [
			{
				id: 'reply',
				contentText: 'Agent response.',
				contentJson: null,
				createdAt: 200n,
				createdByUserId: 'agent',
				createdByAgent: true,
				authorName: 'Agent',
				authorAvatarUrl: null,
			},
		]
		const deletion = thread('delete', {
			kind: 'deletion',
			content_text: 'Delete this',
			anchor_json: blockAnchor,
			created_at: 200n,
		})
		const approval = thread(
			'approve',
			{ kind: 'approval', content_text: 'Looks good', created_at: 300n },
			{ status: 'outdated' },
		)

		const result = exportFeedbackMarkdown(
			{ artifactId: 'artifact-1', fileName: 'design.md' },
			[normal, deletion, approval],
		)

		expect(result.rootCommentIds).toEqual(['normal', 'delete', 'approve'])
		expect(result.markdown).toBe(`<comments for="design.md">
<comment id="normal">
  | Before
> | exact selected text
  | After

Ada: Please clarify this.
  Agent: Agent response.
</comment>

<comment id="delete">
  | Before
> | Whole block
  | After

Ada: Delete this
</comment>

<comment id="approve">
  | Before
> | exact selected text
  | After

Ada: Looks good
</comment>
</comments>`)
		expect(result.markdown).not.toContain('anchor_json')
		expect(result.markdown).not.toContain('V2 anchor')
		expect(result.markdown).not.toContain('Artifact ID')
	})

	test('excludes resolved and deleted roots even if a caller supplies them', () => {
		const result = exportFeedbackMarkdown(
			{ artifactId: 'artifact-1', fileName: 'design.md' },
			[thread('open'), thread('resolved', { is_resolved: true }), thread('deleted', { is_deleted: true })],
		)

		expect(result.rootCommentIds).toEqual(['open'])
		expect(result.markdown).toContain('<comments for="design.md">')
		expect(result.markdown).not.toContain('resolved')
		expect(result.markdown).not.toContain('deleted')
	})

	test('exports only replies retained by the tombstone-filtered projection', () => {
		const projectedThread = thread('open')
		projectedThread.replies = [
			{
				id: 'visible-reply',
				contentText: 'Visible reply.',
				contentJson: null,
				createdAt: 200n,
				createdByUserId: 'user-2',
				createdByAgent: false,
				authorName: 'Grace',
				authorAvatarUrl: null,
			},
		]

		const result = exportFeedbackMarkdown(
			{ artifactId: 'artifact-1', fileName: 'design.md' },
			[projectedThread, thread('deleted-thread', { is_deleted: true })],
		)

		expect(result.rootCommentIds).toEqual(['open'])
		expect(result.markdown).toContain('Visible reply.')
		expect(result.markdown).not.toContain('deleted-thread')
		expect(result.markdown).not.toContain('Tombstoned reply')
	})

	test('omits document context when a V2 anchor is unavailable', () => {
		const result = exportFeedbackMarkdown(
			{ artifactId: 'artifact-1', fileName: 'design.md' },
			[thread('invalid', { anchor_json: null })],
		)

		expect(result.markdown).toBe(`<comments for="design.md">
<comment id="invalid">
Ada: Please clarify this.
</comment>
</comments>`)
	})
})

describe('exportThreadFeedbackMarkdown', () => {
	test('formats one root plus every reply in order, human and agent authors, without sibling threads', () => {
		const target = thread('target')
		target.replies = [
			{
				id: 'reply-human',
				contentText: 'Human follow-up.',
				contentJson: null,
				createdAt: 150n,
				createdByUserId: 'user-2',
				createdByAgent: false,
				authorName: 'Grace',
				authorAvatarUrl: null,
			},
			{
				id: 'reply-agent',
				contentText: 'Agent response.',
				contentJson: null,
				createdAt: 200n,
				createdByUserId: 'agent',
				createdByAgent: true,
				authorName: 'Agent',
				authorAvatarUrl: null,
			},
		]

		const result = exportThreadFeedbackMarkdown({ artifactId: 'artifact-1', fileName: 'design.md' }, target)

		expect(result?.rootCommentIds).toEqual(['target'])
		expect(result?.markdown).toBe(`<comments for="design.md">
<comment id="target">
  | Before
> | exact selected text
  | After

Ada: Please clarify this.
  Grace: Human follow-up.
  Agent: Agent response.
</comment>
</comments>`)
	})

	test('one-thread payload stays separate from bulk formatting and never includes siblings', () => {
		const target = thread('target')
		const sibling = thread('sibling', { content_text: 'Sibling feedback.' })

		const bulk = exportFeedbackMarkdown({ artifactId: 'artifact-1', fileName: 'design.md' }, [target, sibling])
		const single = exportThreadFeedbackMarkdown({ artifactId: 'artifact-1', fileName: 'design.md' }, target)

		expect(bulk.rootCommentIds).toEqual(['target', 'sibling'])
		expect(bulk.markdown).toContain('<comment id="sibling">')
		expect(single?.rootCommentIds).toEqual(['target'])
		expect(single?.markdown).not.toContain('sibling')
		expect(single?.markdown).not.toContain('Sibling feedback.')
	})

	test('returns null at the action boundary for resolved and deleted roots', () => {
		expect(
			exportThreadFeedbackMarkdown(
				{ artifactId: 'artifact-1', fileName: 'design.md' },
				thread('resolved', { is_resolved: true }),
			),
		).toBeNull()
		expect(
			exportThreadFeedbackMarkdown(
				{ artifactId: 'artifact-1', fileName: 'design.md' },
				thread('deleted', { is_deleted: true }),
			),
		).toBeNull()
	})
})
