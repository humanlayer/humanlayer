import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { collectAnchorBlocks, createWholeBlockAnchor } from '../anchor/block-text-offsets'
import { projectArtifactComments } from './project-comments'
import { commentRow as row } from '../test-utils/comment-row'

let editors: Editor[] = []
afterEach(() => {
	for (const editor of editors) editor.destroy()
	editors = []
})

function editorFor(markdown = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.') {
	const editor = new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown' })
	editors.push(editor)
	return editor
}

function anchoredRoot(editor: Editor, id: string, blockIndex: number, createdAt: bigint = 100n) {
	const blocks = collectAnchorBlocks(editor.state.doc)
	return row(id, { anchor_json: createWholeBlockAnchor(blocks, blockIndex), created_at: createdAt })
}

describe('projectArtifactComments', () => {
	test('projects member, agent, and identity-neutral external display authors', () => {
		const editor = editorFor()
		const member = anchoredRoot(editor, 'member', 0)
		const agent = anchoredRoot(editor, 'agent', 1)
		agent.created_by_user_id = 'agent-id'
		agent.created_by_agent = true
		const external = anchoredRoot(editor, 'external', 2)
		external.created_by_user_id = 'external-id'
		const projection = projectArtifactComments(
			[member, agent, external],
			editor.state.doc,
			new Map([
				['user-1', { displayName: 'Member author', avatarUrl: 'member.png' }],
				['external-id', { displayName: 'Guest reviewer', avatarUrl: 'guest.png' }],
			]),
		)

		expect(projection.threads.map((thread) => [thread.authorName, thread.authorAvatarUrl])).toEqual([
			['Member author', 'member.png'],
			['Agent', null],
			['Guest reviewer', 'guest.png'],
		])
	})

	test('one V2 root with ordered replies produces one thread and one highlight from the same placement', () => {
		const editor = editorFor()
		const root = anchoredRoot(editor, 'root', 0)
		const later = row('later', { reply_to_comment_id: root.id, created_at: 300n, created_by_user_id: 'user-2' })
		const earlier = row('earlier', { reply_to_comment_id: root.id, created_at: 200n })
		const projection = projectArtifactComments(
			[root, later, earlier],
			editor.state.doc,
			new Map([
				['user-1', { displayName: 'Ada' }],
				['user-2', { displayName: 'Grace' }],
			]),
		)

		expect(projection.threads).toHaveLength(1)
		expect(projection.threads[0]!.replies.map((reply) => reply.id)).toEqual(['earlier', 'later'])
		expect(projection.threads[0]!.participants.map((participant) => participant.name)).toEqual(['Ada', 'Grace'])
		expect(projection.highlights).toEqual([
			{
				rootCommentId: 'root',
				from: projection.threads[0]!.placement.status === 'resolved' ? projection.threads[0]!.placement.from : -1,
				to: projection.threads[0]!.placement.status === 'resolved' ? projection.threads[0]!.placement.to : -1,
				createdAt: 100,
				kind: 'comment',
			},
		])
	})

	test('replies carry resolved presentation identity; agent replies fall back to an Agent label', () => {
		const editor = editorFor()
		const root = anchoredRoot(editor, 'root', 0)
		const human = row('human-reply', {
			reply_to_comment_id: root.id,
			created_at: 200n,
			created_by_user_id: 'user-2',
			content_json: { type: 'doc', content: [{ type: 'paragraph' }] },
		})
		const agent = row('agent-reply', {
			reply_to_comment_id: root.id,
			created_at: 300n,
			created_by_user_id: 'agent-x',
			created_by_agent: true,
		})
		const projection = projectArtifactComments(
			[root, human, agent],
			editor.state.doc,
			new Map([['user-2', { displayName: 'Grace', avatarUrl: 'grace.png' }]]),
		)

		const replies = projection.threads[0]!.replies
		expect(replies.map((reply) => reply.id)).toEqual(['human-reply', 'agent-reply'])
			expect(replies[0]).toMatchObject({
			authorName: 'Grace',
			authorAvatarUrl: 'grace.png',
			createdByAgent: false,
			contentText: 'human-reply',
			contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
			createdByUserId: 'user-2',
		})
		expect(replies[1]).toMatchObject({
			authorName: 'Agent',
			authorAvatarUrl: null,
			createdByAgent: true,
		})
	})

	test('a typed verdict root carries its kind onto the resolved highlight', () => {
		const editor = editorFor()
		const deletion = row('del', {
			anchor_json: createWholeBlockAnchor(collectAnchorBlocks(editor.state.doc), 0),
			kind: 'deletion',
		})
		const projection = projectArtifactComments([deletion], editor.state.doc, new Map([['user-1', { displayName: 'Ada' }]]))
		expect(projection.highlights).toHaveLength(1)
		expect(projection.highlights[0]!.kind).toBe('deletion')
	})

	test('legacy roots and all replies following them are excluded', () => {
		const editor = editorFor()
		const legacy = row('legacy')
		const replyWithAnchor = row('reply', {
			reply_to_comment_id: legacy.id,
			anchor_json: createWholeBlockAnchor(collectAnchorBlocks(editor.state.doc), 0),
		})
		const projection = projectArtifactComments([legacy, replyWithAnchor], editor.state.doc, new Map())
		expect(projection.threads).toEqual([])
		expect(projection.highlights).toEqual([])
	})

	test('deleted and resolved roots are absent, and deleted replies are omitted', () => {
		const editor = editorFor()
		const open = anchoredRoot(editor, 'open', 0)
		const deletedRoot = anchoredRoot(editor, 'deleted-root', 1)
		deletedRoot.is_deleted = true
		const resolvedRoot = anchoredRoot(editor, 'resolved-root', 2)
		resolvedRoot.is_resolved = true
		const deletedReply = row('deleted-reply', { reply_to_comment_id: open.id, is_deleted: true })
		const reply = row('reply', { reply_to_comment_id: open.id })
		const projection = projectArtifactComments(
			[open, deletedRoot, resolvedRoot, deletedReply, reply],
			editor.state.doc,
			new Map(),
		)
		expect(projection.threads.map((thread) => thread.root.id)).toEqual(['open'])
		expect(projection.threads[0]!.replies.map((item) => item.id)).toEqual(['reply'])
		expect(projection.highlights).toHaveLength(1)
	})

	test('outdated and malformed anchors stay in the rail projection without highlights', () => {
		const editor = editorFor()
		const outdated = anchoredRoot(editorFor('Removed text.'), 'outdated', 0, 200n)
		const malformed = row('malformed', {
			anchor_json: { v: 2 } as ArtifactComment['anchor_json'],
			created_at: 300n,
		})
		const nullAnchor = row('null-anchor')
		const projection = projectArtifactComments([outdated, malformed, nullAnchor], editor.state.doc, new Map())
		expect(projection.threads.map((thread) => [thread.root.id, thread.placement.status])).toEqual([
			['outdated', 'outdated'],
			['malformed', 'outdated'],
		])
		expect(projection.highlights).toEqual([])
	})

	test('outdated roots carry an approximate hint from surviving neighbors without changing completion or highlights', () => {
		const original = editorFor('Before.\n\nRemoved.\n\nAfter.')
		const editor = editorFor('Before.\n\nReplacement.\n\nAfter.')
		const open = anchoredRoot(original, 'open', 1)
		const done = { ...anchoredRoot(original, 'done', 1), is_resolved: true }
		const lost = anchoredRoot(editorFor('Gone.'), 'lost', 0)
		const projection = projectArtifactComments([open, done, lost], editor.state.doc, new Map())
		const before = collectAnchorBlocks(editor.state.doc)[0]!

		expect(projection.threads.map((thread) => [thread.root.id, thread.placement.status, thread.approximate])).toEqual([
			['lost', 'outdated', null],
			['open', 'outdated', { blockPos: before.pos, edge: 'after' }],
		])
		expect(projection.resolvedThreads.map((thread) => [thread.root.id, thread.approximate])).toEqual([
			['done', { blockPos: before.pos, edge: 'after' }],
		])
		expect(projection.highlights).toEqual([])
		expect(open.anchor_json).toEqual(anchoredRoot(original, 'open', 1).anchor_json)
	})

	test('resolved threads sort by document position before outdated threads sorted by creation time', () => {
		const editor = editorFor()
		const second = anchoredRoot(editor, 'second', 1, 10n)
		const first = anchoredRoot(editor, 'first', 0, 400n)
		const oldOutdated = row('old-outdated', {
			anchor_json: { v: 2 } as ArtifactComment['anchor_json'],
			created_at: 20n,
		})
		const newOutdated = row('new-outdated', {
			anchor_json: { v: 2 } as ArtifactComment['anchor_json'],
			created_at: 30n,
		})
		const projection = projectArtifactComments(
			[newOutdated, second, oldOutdated, first],
			editor.state.doc,
			new Map(),
		)
		expect(projection.threads.map((thread) => thread.root.id)).toEqual([
			'first',
			'second',
			'old-outdated',
			'new-outdated',
		])
	})

	test('roots sharing a range remain distinct with deterministic creation facts', () => {
		const editor = editorFor()
		const later = anchoredRoot(editor, 'later', 0, 200n)
		const earlier = anchoredRoot(editor, 'earlier', 0, 100n)
		const projection = projectArtifactComments([later, earlier], editor.state.doc, new Map())
		expect(projection.threads.map((thread) => thread.root.id)).toEqual(['earlier', 'later'])
		expect(projection.highlights.map(({ rootCommentId, createdAt }) => ({ rootCommentId, createdAt }))).toEqual([
			{ rootCommentId: 'earlier', createdAt: 100 },
			{ rootCommentId: 'later', createdAt: 200 },
		])
	})

	test('resolved roots leave the open threads/highlights but stay available in resolvedThreads', () => {
		const editor = editorFor()
		const open = anchoredRoot(editor, 'open', 0)
		const resolvedRoot = anchoredRoot(editor, 'resolved-root', 2)
		resolvedRoot.is_resolved = true
		const resolvedReply = row('resolved-reply', { reply_to_comment_id: resolvedRoot.id, created_at: 300n })
		const projection = projectArtifactComments([open, resolvedRoot, resolvedReply], editor.state.doc, new Map())

		expect(projection.threads.map((thread) => thread.root.id)).toEqual(['open'])
		expect(projection.highlights.map((highlight) => highlight.rootCommentId)).toEqual(['open'])
		expect(projection.rootIds.has('resolved-root')).toBe(false)
		// The resolved thread — and its replies — is available to the rail projection.
		expect(projection.resolvedThreads.map((thread) => thread.root.id)).toEqual(['resolved-root'])
		expect(projection.resolvedThreads[0]!.replies.map((reply) => reply.id)).toEqual(['resolved-reply'])
	})

	test('a resolved, deleted, or disappeared root leaves both projection views together', () => {
		const editor = editorFor()
		const root = anchoredRoot(editor, 'root', 0)
		const initial = projectArtifactComments([root], editor.state.doc, new Map())
		expect(initial.rootIds.has('root')).toBe(true)
		expect(initial.highlights.map((highlight) => highlight.rootCommentId)).toEqual(['root'])

		for (const rows of [[{ ...root, is_resolved: true }], [{ ...root, is_deleted: true }], []]) {
			const updated = projectArtifactComments(rows, editor.state.doc, new Map())
			expect(updated.rootIds.has('root')).toBe(false)
			expect(updated.threads).toEqual([])
			expect(updated.highlights).toEqual([])
		}
	})

	test('a fully tombstoned thread contributes no rail row, resolved row, or highlight', () => {
		const editor = editorFor()
		const root = anchoredRoot(editor, 'deleted-root', 0)
		root.is_deleted = true
		const reply = row('deleted-reply', {
			reply_to_comment_id: root.id,
			is_deleted: true,
		})
		const projection = projectArtifactComments([root, reply], editor.state.doc, new Map())

		expect(projection.threads).toEqual([])
		expect(projection.resolvedThreads).toEqual([])
		expect(projection.highlights).toEqual([])
		expect(projection.rootIds).toEqual(new Set())
	})
})
