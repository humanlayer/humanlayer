import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Highlight } from '@tiptap/extension-highlight'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { BlockMath } from '@tiptap/extension-mathematics'
import { Mention } from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import { Typography } from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import type { Node } from '@tiptap/pm/model'
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef } from 'react'
import { all, createLowlight } from 'lowlight'

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createCodeBlockComponent, type CustomLanguageRenderers } from './CodeBlock'
import { TaskItemComponent } from './TaskItemComponent'
import { Code } from '@tiptap/extension-code'

import { ArtifactSearch } from './ArtifactSearchExtension'
import { CommentMark } from './CommentMark'
import {
	CommentGutter,
	findLineNumberForText,
	getMarkdownLineAt,
	setExternalBlockComments,
	type BlockClickInfo,
	type CommentBlockHoverInfo,
	type CommentClickInfo,
	type ExternalBlockComment,
} from './CommentGutter'
import { CommentGutterOverlay, type GutterItemInfo } from './CommentGutterOverlay'
import { type MatchableBlock, matchCommentToBlock } from './comment-matching'
import { FrontmatterNode } from './FrontmatterNode'
import { parseFrontmatter } from './parseFrontmatter'

import '../styles/tiptap.css'

export interface CommentData {
	commentId: string
	authorName: string
	authorAvatarUrl: string
	color?: string
	/** Text content of the block being commented on (rendered, no markdown syntax) */
	commentedUponBlockText: string
	/** Text content of the previous block (null if first block) */
	previousBlockText: string | null
	/** Text content of the next block (null if last block) */
	nextBlockText: string | null
	/** All unique participants in this comment's thread (root + reply authors) */
	participants?: Array<{ name: string; avatarUrl: string }>
}

export interface SelectionInfo {
	/** Absolute from position in the ProseMirror doc */
	from: number
	/** Absolute to position in the ProseMirror doc */
	to: number
	/** The selected text content */
	text: string
	/** 1-based line number of the selection start in the source markdown (best effort) */
	lineNumber: number | null
	/** Bounding rect of the selection for positioning UI elements (viewport coordinates) */
	rect: DOMRect
	/** Raw markdown source line at lineNumber (when available) - useful as fallback span */
	markdownLine?: string
}

export interface MarkdownViewerProps {
	content: string
	className?: string
	/** Inline comments to render as text highlights with gutter avatars */
	comments?: CommentData[]
	/** Block-level comments (for code blocks, blockquotes, etc.) */
	blockComments?: ExternalBlockComment[]
	/** Fired when a commented block is clicked */
	onCommentClick?: (info: CommentClickInfo) => void
	/** Fired when any block is clicked (for adding block-level comments) */
	onBlockClick?: (info: BlockClickInfo) => void
	/** Fired when the user selects text (empty selection = null) */
	onSelectionChange?: (info: SelectionInfo | null) => void
	/** Ref to access the TipTap editor instance directly */
	editorRef?: React.MutableRefObject<Editor | null>
	/** Fired when a gutter avatar group is hovered (null = mouse left) */
	onGutterItemHover?: (info: GutterItemInfo | null) => void
	/** Fired when a gutter avatar group is clicked */
	onGutterItemClick?: (info: GutterItemInfo) => void
	/** Fired when mouse enters/leaves a commented block highlight (null = mouse left) */
	onCommentBlockHover?: (info: CommentBlockHoverInfo | null) => void
	/** Hide the comment gutter overlay AND reclaim the right-hand padding reserved for it.
	 *  Useful for narrow viewports (mobile) where commenting isn't exposed. */
	hideCommentGutter?: boolean
	/** Use a tighter gutter that auto-hides only at very narrow widths. */
	compactCommentGutter?: boolean
	/** Custom language renderers for code blocks (e.g., { 'task-artifact': TaskArtifactViewer }) */
	customLanguageRenderers?: CustomLanguageRenderers
}

const lowlight = createLowlight(all)

/**
 * Apply comment marks to the editor doc using context-based block matching.
 * Matches blocks by textContent + previous/next block text for anchoring.
 * Code blocks don't allow marks, so we return them as external block comments instead.
 */
export function applyComments(editor: Editor, comments: CommentData[]): ExternalBlockComment[] {
	const { doc, tr } = editor.state
	let modified = false
	const externalBlockComments: ExternalBlockComment[] = []

	// First, remove all existing comment marks so deleted comments disappear
	const commentMarkType = editor.schema.marks.comment
	if (commentMarkType) {
		doc.descendants((node, pos) => {
			if (!node.isText) return
			const commentMark = node.marks.find((m) => m.type === commentMarkType)
			if (commentMark) {
				tr.removeMark(pos, pos + node.nodeSize, commentMarkType)
				modified = true
			}
		})
	}

	// Collect all textblocks with their prev/next context. Keep the matched
	// ProseMirror node alongside the MatchableBlock shape so we can inspect its
	// children (to detect block-level nodes that can't take an inline mark).
	const blocks: MatchableBlock[] = []
	const nodesByIdx: Node[] = []
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return
		blocks.push({ pos, text: node.textContent, nodeType: node.type.name, nodeSize: node.nodeSize })
		nodesByIdx.push(node)
	})

	for (const comment of comments) {
		// Find matching block using the shared context-based anchoring helper.
		const bestIdx = matchCommentToBlock(blocks, comment)
		if (bestIdx === -1) continue

		const best = blocks[bestIdx]!
		const bestNode = nodesByIdx[bestIdx]!

		// Un-markable: code blocks (existing) OR a textblock that markdown nested a
		// block-level node into (e.g. an inline image -> isInline === false). An inline
		// comment mark is schema-invalid across these for ANY range, so route to the
		// gutter exactly like code blocks instead of calling addMark.
		//
		// Predicate is `!child.isInline`, NOT `!child.isText`: mentions and inline math
		// are isInline=true and mark fine, so only true block-level children are routed.
		let hasNonInlineChild = false
		bestNode.forEach((child) => {
			if (!child.isInline) hasNonInlineChild = true
		})

		if (best.nodeType === 'codeBlock' || hasNonInlineChild) {
			externalBlockComments.push({
				commentId: comment.commentId,
				authorName: comment.authorName,
				authorAvatarUrl: comment.authorAvatarUrl,
				color: comment.color,
				blockPos: best.pos,
				participants: comment.participants || [],
			})
			continue
		}

		const markType = editor.schema.marks.comment
		if (markType === undefined) continue
		const mark = markType.create({
			commentId: comment.commentId,
			authorName: comment.authorName,
			authorAvatarUrl: comment.authorAvatarUrl,
			color: comment.color || '#fbbf24',
			lineNumber: 0,
			participants: comment.participants || [],
		})

		// Mark the entire block. nodeSize gives the boundary-correct content span
		// (content start pos+1, content end pos+nodeSize-1), which fixes prior
		// under-marking of blocks containing inline atoms (mentions / inline math).
		const from = best.pos + 1
		const to = best.pos + best.nodeSize - 1
		try {
			tr.addMark(from, to, mark)
			modified = true
		} catch (err) {
			// Backstop only — tr.addMark is atomic (throws before committing any steps,
			// verified), so the shared tr stays clean and other comments still apply.
			// Proactive gutter routing above handles the known crash shape; this catches
			// any other unexpected invalid range. Log + skip this one comment.
			console.warn('skipped un-markable comment', { commentId: comment.commentId, err })
		}
	}

	if (modified) {
		editor.view.dispatch(tr)
	}

	return externalBlockComments
}

export function MarkdownViewer({
	content,
	className,
	comments,
	blockComments,
	onCommentClick,
	onBlockClick,
	onSelectionChange,
	editorRef,
	onGutterItemHover,
	onGutterItemClick,
	onCommentBlockHover,
	hideCommentGutter = false,
	compactCommentGutter = false,
	customLanguageRenderers,
}: MarkdownViewerProps) {
	const prevCommentsRef = useRef<CommentData[] | undefined>(undefined)
	const prevBlockCommentsRef = useRef<ExternalBlockComment[] | undefined>(undefined)

	const CodeBlockComponent = createCodeBlockComponent(customLanguageRenderers)

	const { data: frontmatterData, body } = parseFrontmatter(content)

	const handleSelectionUpdate = useCallback(
		({ editor: e }: { editor: Editor }) => {
			if (!onSelectionChange) return
			const { from, to, empty } = e.state.selection
			if (empty) {
				onSelectionChange(null)
				return
			}
			const text = e.state.doc.textBetween(from, to, ' ')
			if (text.trim().length === 0) {
				onSelectionChange(null)
				return
			}

			// Anchor on the nearest textblock ancestor at selection start.
			let lineNumber: number | null = null
			let fromParentTextblock = false
			const resolvedStart = e.state.doc.resolve(from)
			for (let depth = resolvedStart.depth; depth > 0; depth--) {
				const node = resolvedStart.node(depth)
				if (!node.isTextblock) continue
				lineNumber = findLineNumberForText(content, node.textContent)
				if (lineNumber !== null) {
					fromParentTextblock = true
				}
				break
			}

			// Fallback: try selected text directly
			if (lineNumber === null) {
				const selectedText = text.trim()
				if (selectedText.length > 0) {
					lineNumber = findLineNumberForText(content, selectedText)
				}
			}

			// Get raw markdown line when using parent textblock fallback
			let markdownLine: string | undefined
			if (fromParentTextblock && lineNumber !== null) {
				markdownLine = getMarkdownLineAt(content, lineNumber)
			}

			// Compute bounding rect from ProseMirror coordinates
			const fromCoords = e.view.coordsAtPos(from)
			const toCoords = e.view.coordsAtPos(to)
			const rect = new DOMRect(
				Math.min(fromCoords.left, toCoords.left),
				Math.min(fromCoords.top, toCoords.top),
				Math.abs(toCoords.right - fromCoords.left),
				Math.max(toCoords.bottom, fromCoords.bottom) - Math.min(fromCoords.top, toCoords.top),
			)

			onSelectionChange({ from, to, text, lineNumber, rect, markdownLine })
		},
		[onSelectionChange, content],
	)

	const editor = useEditor({
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
			CommentMark,
			CommentGutter.configure({
				sourceMarkdown: content,
				onCommentClick,
				onBlockClick,
				onCommentBlockHover,
			}),
			FrontmatterNode.configure({ data: frontmatterData }),
		],
		content: body,
		contentType: 'markdown',
		editable: false,
		editorProps: {
			attributes: { class: 'tiptap' },
		},
		onSelectionUpdate: handleSelectionUpdate,
	})

	// Expose the editor instance
	useEffect(() => {
		if (editorRef) {
			editorRef.current = editor
		}
	}, [editor, editorRef])

	// NOTE: Content sync is handled via key prop on parent (ArtifactViewer)
	// When content changes, the parent remounts this component with key={content}
	// This follows Rule 5: Reset with key, not dependency choreography

	// Apply inline comments when they change (also clears marks for deleted comments)
	// For code blocks that don't support marks, applyComments returns external block comments
	useEffect(() => {
		if (!editor?.view) return
		if (comments === prevCommentsRef.current && blockComments === prevBlockCommentsRef.current) return
		prevCommentsRef.current = comments
		prevBlockCommentsRef.current = blockComments

		// applyComments returns external block comments for nodes that don't support marks (like code blocks)
		const codeBlockComments = applyComments(editor, comments ?? [])

		// Merge explicit blockComments with code block comments derived from text matching
		const allBlockComments = [...(blockComments ?? []), ...codeBlockComments]
		setExternalBlockComments(editor.view, allBlockComments)
	}, [editor, comments, blockComments])

	return (
		<div
			className={`tiptap-comment-wrapper${hideCommentGutter ? ' tiptap-no-gutter' : ''}${compactCommentGutter ? ' tiptap-compact-gutter' : ''} ${className ?? ''}`}
		>
			<EditorContent editor={editor} />
			{!hideCommentGutter && (
				<CommentGutterOverlay
					editor={editor}
					onGutterItemHover={onGutterItemHover}
					onGutterItemClick={onGutterItemClick}
				/>
			)}
		</div>
	)
}
