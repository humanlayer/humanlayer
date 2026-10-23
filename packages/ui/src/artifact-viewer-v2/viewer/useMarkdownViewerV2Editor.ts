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
import { ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { all, createLowlight } from 'lowlight'
import { useRef } from 'react'

import { createCodeBlockComponent, type CustomLanguageRenderers } from '../../markdown-viewer/CodeBlock'
import { ArtifactSearch } from '../../markdown-viewer/ArtifactSearchExtension'
import { FrontmatterNode } from '../../markdown-viewer/FrontmatterNode'
import { parseFrontmatter } from '../../markdown-viewer/parseFrontmatter'
import { TaskItemComponent } from '../../markdown-viewer/TaskItemComponent'
import { SectionFoldingExtension } from '../folding/SectionFoldingExtension'
import { CommentHighlightExtension } from './CommentHighlightExtension'
import { KeyboardFocusExtension } from './KeyboardFocusExtension'
import { extractRenderedSelection } from './rendered-range'
import { buildSelectionIntent, type SelectionResult } from './selection'

const lowlight = createLowlight(all)

export interface UseMarkdownViewerV2EditorOptions {
	content: string
	customLanguageRenderers?: CustomLanguageRenderers
}

export type SelectionInputSource = 'mouse' | 'keyboard'
export type SelectionResultHandler = (result: SelectionResult, editor: Editor, source: SelectionInputSource) => void

function selectionRectFallback(editor: Editor, from: number, to: number): DOMRect | null {
	try {
		const fromCoords = editor.view.coordsAtPos(from)
		const toCoords = editor.view.coordsAtPos(to)
		const left = Math.min(fromCoords.left, toCoords.left)
		const top = Math.min(fromCoords.top, toCoords.top)
		return new DOMRect(left, top, Math.abs(toCoords.right - left), Math.max(fromCoords.bottom, toCoords.bottom) - top)
	} catch {
		return null
	}
}

/**
 * Replace a live viewer editor's document with new artifact markdown, keeping
 * the editor instance. Mirrors creation: FrontmatterNode only inserts its block
 * in `onCreate`, so the swap re-inserts it in the same transaction. The
 * transaction emits `update`, which consumers use to re-derive the document.
 */
export function replaceEditorMarkdown(editor: Editor, content: string): void {
	const { data, body } = parseFrontmatter(content)
	const chain = editor.chain().setContent(body, { contentType: 'markdown' })
	if (Object.keys(data).length > 0) {
		chain.insertContentAt(0, { type: 'frontmatter', attrs: { data } }, { updateSelection: false })
	}
	chain.run()
}

/** Create the read-only Artifact Viewer V2 TipTap editor. */
export function useMarkdownViewerV2Editor({
	content,
	customLanguageRenderers,
}: UseMarkdownViewerV2EditorOptions,
onSelectionResult?: SelectionResultHandler): Editor | null {
	const CodeBlockComponent = createCodeBlockComponent(customLanguageRenderers)
	const { data: frontmatterData, body } = parseFrontmatter(content)
	const mouseSelectingRef = useRef(false)

	return useEditor({
		extensions: [
			StarterKit.configure({ codeBlock: false }),
			Code,
			Markdown,
			Typography,
			Image,
			Highlight,
			Details,
			DetailsContent,
			DetailsSummary,
			TaskItem.extend({
				addNodeView() {
					return ReactNodeViewRenderer(TaskItemComponent)
				},
			}),
			TaskList,
			Mention,
			BlockMath,
			TableKit,
			CodeBlockLowlight.extend({
				addNodeView() {
					return ReactNodeViewRenderer(CodeBlockComponent)
				},
			}).configure({ lowlight }),
			FrontmatterNode.configure({ data: frontmatterData }),
			KeyboardFocusExtension,
			SectionFoldingExtension,
			ArtifactSearch,
			CommentHighlightExtension,
		],
		content: body,
		contentType: 'markdown',
		editable: false,
		editorProps: {
			attributes: { class: 'tiptap' },
			handleDOMEvents: {
				mousedown: (view) => {
					mouseSelectingRef.current = true
					view.dom.ownerDocument.addEventListener(
						'mouseup',
						() => {
							queueMicrotask(() => {
								mouseSelectingRef.current = false
							})
						},
						{ once: true },
					)
					return false
				},
			},
		},
		onSelectionUpdate: ({ editor }) => {
			const handler = onSelectionResult
			if (!handler) return
			const source: SelectionInputSource = mouseSelectingRef.current ? 'mouse' : 'keyboard'
			const { from, to, empty } = editor.state.selection
			if (empty) {
				handler({ status: 'empty' }, editor, source)
				return
			}
			const rendered = extractRenderedSelection(
				editor.view.dom.ownerDocument.getSelection(),
				editor.view.dom as HTMLElement,
			)
			if (!rendered) {
				handler({ status: 'empty' }, editor, source)
				return
			}
			const result = buildSelectionIntent(editor.state.doc, from, to, rendered.quote, rendered.rect)
			if (result.status === 'selection' && result.intent.rect == null) {
				handler(
					{
						status: 'selection',
						intent: { ...result.intent, rect: selectionRectFallback(editor, result.intent.from, result.intent.to) },
					},
					editor,
					source,
				)
				return
			}
			handler(result, editor, source)
		},
	})
}
