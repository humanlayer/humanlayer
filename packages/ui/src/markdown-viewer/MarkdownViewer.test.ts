import { Editor } from '@tiptap/core'
import { Code } from '@tiptap/extension-code'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { BlockMath } from '@tiptap/extension-mathematics'
import { Mention } from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import { Typography } from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { all, createLowlight } from 'lowlight'
import { afterEach, describe, expect, test } from 'vitest'
import { ArtifactSearch } from './ArtifactSearchExtension'
import { CommentMark } from './CommentMark'
import { applyComments, type CommentData } from './MarkdownViewer'

const lowlight = createLowlight(all)

/**
 * Build a headless editor using the production schema-relevant extension set.
 * (React node-view wrappers from the live component are dropped — they don't
 * affect markdown parsing or the mark/image schema that this test exercises.)
 */
function makeEditor(markdown: string): Editor {
	return new Editor({
		extensions: [
			StarterKit.configure({ codeBlock: false }),
			Code,
			Markdown,
			Typography,
			Image,
			Highlight,
			ArtifactSearch,
			Details,
			DetailsContent,
			DetailsSummary,
			TaskItem,
			TaskList,
			Mention,
			BlockMath,
			TableKit,
			CodeBlockLowlight.configure({ lowlight }),
			CommentMark,
		],
		content: markdown,
		contentType: 'markdown',
		editable: false,
	})
}

function countCommentMarks(editor: Editor): number {
	const commentMarkType = editor.schema.marks.comment
	let count = 0
	editor.state.doc.descendants((node) => {
		if (node.isText && node.marks.some((m) => m.type === commentMarkType)) count++
	})
	return count
}

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

function track(editor: Editor): Editor {
	editors.push(editor)
	return editor
}

describe('applyComments', () => {
	test('crash regression: inline-image paragraph routes to gutter, other text-block comment still marks, no throw', () => {
		// The image paragraph renders to a single paragraph that nests an inline
		// `image` node (isInline=false). An inline comment mark is schema-invalid
		// across it for ANY range — the historical crash.
		const markdown = [
			'Please review the open design questions for this artifact.',
			'',
			'Option A: ![preview](https://x.com/p.png) "Showing the public preview"',
			'',
			'Please review the options above and pick one.',
		].join('\n')

		const editor = track(makeEditor(markdown))

		// The live rendered text of the image paragraph (image collapses to spaces).
		const imageBlockText = editor.state.doc.child(1).textContent

		const comments: CommentData[] = [
			{
				commentId: 'image-comment',
				authorName: 'Pat',
				authorAvatarUrl: '',
				commentedUponBlockText: imageBlockText,
				previousBlockText: 'Please review the open design questions for this artifact.',
				nextBlockText: 'Please review the options above and pick one.',
			},
			{
				commentId: 'text-comment',
				authorName: 'Pat',
				authorAvatarUrl: '',
				commentedUponBlockText: 'Please review the options above and pick one.',
				previousBlockText: imageBlockText,
				nextBlockText: null,
			},
		]

		let external: ReturnType<typeof applyComments> = []
		expect(() => {
			external = applyComments(editor, comments)
		}).not.toThrow()

		// Image-block comment is routed to the gutter (anchored, not dropped).
		expect(external.map((c) => c.commentId)).toContain('image-comment')
		// The normal text block still received a valid inline comment mark.
		expect(countCommentMarks(editor)).toBeGreaterThan(0)
	})

	test('parses double-dollar math without activating on single dollars', () => {
		const markdown = ['The cost is $5 today.', '', '$$x + y$$'].join('\n')
		const editor = track(makeEditor(markdown))

		expect(editor.state.doc.child(0).textContent).toBe('The cost is $5 today.')
		expect(editor.state.doc.child(0).type.name).toBe('paragraph')
		expect(editor.state.doc.child(1).type.name).toBe('blockMath')
		expect(editor.state.doc.child(1).attrs.latex).toBe('x + y')
	})
})
