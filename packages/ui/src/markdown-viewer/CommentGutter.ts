import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface BlockComment {
	commentId: string
	authorName: string
	authorAvatarUrl: string
	color: string
	/** 1-based line number in the source markdown */
	lineNumber: number
	/** All unique participants in this comment's thread */
	participants: Array<{ name: string; avatarUrl: string }>
}

export interface CommentedBlock {
	blockPos: number
	comments: BlockComment[]
}

export interface CommentClickInfo {
	/** The raw markdown line text that was clicked */
	markdown: string
	/** 1-based line number in the source markdown */
	lineNumber: number
	/** The comments associated with this block */
	comments: BlockComment[]
	/** Bounding rect of the commented block for positioning UI elements */
	rect: DOMRect
}

/** Info about a block the user clicked on (for adding new comments) */
export interface BlockClickInfo {
	/** Absolute position of the block node in the doc */
	blockPos: number
	/** ProseMirror node type name, e.g. 'codeBlock', 'blockquote', 'paragraph' */
	nodeType: string
	/** Text content of the block (rendered, no markdown syntax) */
	textContent: string
	/** Text content of the previous block (null if this is the first block) */
	previousBlockText: string | null
	/** Text content of the next block (null if this is the last block) */
	nextBlockText: string | null
	/** Bounding rect of the block for positioning UI elements (viewport coordinates) */
	rect: DOMRect
}

/** A block-level comment not derived from inline marks */
export interface ExternalBlockComment {
	commentId: string
	authorName: string
	authorAvatarUrl: string
	color?: string
	/** The block position this comment is attached to */
	blockPos: number
	/** All unique participants in this comment's thread */
	participants?: Array<{ name: string; avatarUrl: string }>
}

// ─── Meta-transaction key for passing external block comments into plugin ────

const EXTERNAL_COMMENTS_META = 'externalBlockComments'
const PENDING_HIGHLIGHT_META = 'pendingHighlightBlock'

export const commentGutterPluginKey = new PluginKey<{
	decorationSet: DecorationSet
	commentedBlocks: CommentedBlock[]
	externalComments: ExternalBlockComment[]
	pendingBlockPos: number | null
}>('commentGutter')

/**
 * Resolve the target block position for comments at the innermost block node.
 */
function resolveCommentBlockPos(state: EditorState, pos: number): number {
	const resolved = state.doc.resolve(pos)
	const blockDepth = resolved.depth
	return resolved.before(blockDepth)
}

/**
 * Scan inline marks to find mark-derived block comments.
 */
function getMarkDerivedBlocks(state: EditorState): Map<number, BlockComment[]> {
	const blockMap = new Map<number, BlockComment[]>()

	state.doc.descendants((node, pos) => {
		if (!node.isText) return

		for (const mark of node.marks) {
			if (mark.type.name !== 'comment') continue

			const blockPos = resolveCommentBlockPos(state, pos)

			if (!blockMap.has(blockPos)) {
				blockMap.set(blockPos, [])
			}

			const existing = blockMap.get(blockPos)!
			if (!existing.some((c) => c.commentId === mark.attrs.commentId)) {
				existing.push({
					commentId: mark.attrs.commentId as string,
					authorName: mark.attrs.authorName as string,
					authorAvatarUrl: mark.attrs.authorAvatarUrl as string,
					color: (mark.attrs.color as string) || '#fbbf24',
					lineNumber: (mark.attrs.lineNumber as number) || 0,
					participants: (mark.attrs.participants as Array<{ name: string; avatarUrl: string }>) || [],
				})
			}
		}
	})

	return blockMap
}

/**
 * Build the full decoration set and commented blocks list from both
 * inline mark-derived comments AND external block-level comments.
 */
function buildCommentData(
	state: EditorState,
	externalComments: ExternalBlockComment[],
) {
	const decorations: Decoration[] = []
	const blockMap = getMarkDerivedBlocks(state)

	// Merge external block comments into the map
	for (const ext of externalComments) {
		if (!blockMap.has(ext.blockPos)) {
			blockMap.set(ext.blockPos, [])
		}
		const existing = blockMap.get(ext.blockPos)!
		if (!existing.some((c) => c.commentId === ext.commentId)) {
			existing.push({
				commentId: ext.commentId,
				authorName: ext.authorName,
				authorAvatarUrl: ext.authorAvatarUrl,
				color: ext.color || '#fbbf24',
				lineNumber: 0,
				participants: ext.participants || [],
			})
		}
	}

	const commentedBlocks: CommentedBlock[] = []
	for (const [blockPos, comments] of blockMap) {
		const node = state.doc.nodeAt(blockPos)
		if (!node) continue

		const firstComment = comments[0]
		if (firstComment === undefined) {
			throw new Error('invariant: commented block has no comments')
		}
		const color = firstComment.color
		decorations.push(
			Decoration.node(blockPos, blockPos + node.nodeSize, {
				class: 'has-comments',
				style: `--comment-color: ${color}`,
				'data-comment-count': String(comments.length),
			}),
		)
		commentedBlocks.push({ blockPos, comments })
	}

	return {
		decorationSet: DecorationSet.create(state.doc, decorations),
		commentedBlocks,
		externalComments,
	}
}

/**
 * Read a 1-based line from the source markdown
 */
export function getMarkdownLineAt(
	sourceMarkdown: string,
	lineNumber: number,
): string {
	if (lineNumber <= 0) return ''
	const lines = sourceMarkdown.split('\n')
	return lines[lineNumber - 1] ?? ''
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function stripMarkdownLineStart(line: string): string {
	let text = line.trimStart()

	// Remove one or more leading blockquote markers.
	while (text.startsWith('>')) {
		text = text.slice(1).trimStart()
	}

	// Remove ATX heading markers, e.g. "## Heading".
	let headingHashes = 0
	while (headingHashes < text.length && text[headingHashes] === '#') {
		headingHashes++
	}
	if (headingHashes > 0 && headingHashes <= 6 && text[headingHashes] === ' ') {
		text = text.slice(headingHashes + 1)
	}

	// Remove unordered list markers, then optional task list marker.
	if (
		text.length > 1 &&
		(text[0] === '-' || text[0] === '*' || text[0] === '+') &&
		text[1] === ' '
	) {
		text = text.slice(2)
		if (
			text.length >= 4 &&
			text[0] === '[' &&
			(text[1] === ' ' || text[1] === 'x' || text[1] === 'X') &&
			text[2] === ']' &&
			text[3] === ' '
		) {
			text = text.slice(4)
		}
	}

	// Remove ordered list markers, e.g. "1. Item" or "1) Item".
	let digitEnd = 0
	while (digitEnd < text.length) {
		const ch = text[digitEnd]
		if (ch === undefined || ch < '0' || ch > '9') break
		digitEnd++
	}
	if (
		digitEnd > 0 &&
		digitEnd + 1 < text.length &&
		(text[digitEnd] === '.' || text[digitEnd] === ')') &&
		text[digitEnd + 1] === ' '
	) {
		text = text.slice(digitEnd + 2)
	}

	return text.trim()
}

function getBlockStartAnchor(textContent: string): string | null {
	for (const line of textContent.split('\n')) {
		const normalized = normalizeWhitespace(line)
		if (normalized.length > 0) return normalized
	}
	return null
}

/**
 * Find the 1-based source markdown line for a rendered block text.
 * Uses the block's first non-empty line as an anchor and returns null if no match.
 */
export function findLineNumberForText(
	sourceMarkdown: string,
	textContent: string,
): number | null {
	if (!sourceMarkdown || !textContent) return null

	// First try: exact indexOf on raw content
	const exactIdx = sourceMarkdown.indexOf(textContent)
	if (exactIdx !== -1) {
		let line = 1
		for (let i = 0; i < exactIdx; i++) {
			if (sourceMarkdown[i] === '\n') line++
		}
		return line
	}

	const anchor = getBlockStartAnchor(textContent)
	if (!anchor) return null

	// Second try: search normalized block starts for exact match.
	const lines = sourceMarkdown.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line === undefined) continue
		const normalizedLine = normalizeWhitespace(stripMarkdownLineStart(line))
		if (normalizedLine === anchor) {
			return i + 1
		}
	}

	// Third try: looser start/contain checks for inline formatting differences.
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line === undefined) continue
		const normalizedLine = normalizeWhitespace(stripMarkdownLineStart(line))
		if (!normalizedLine) continue
		if (
			normalizedLine.startsWith(anchor) ||
			anchor.startsWith(normalizedLine) ||
			normalizedLine.includes(anchor)
		) {
			return i + 1
		}
	}

	return null
}

/** Info about a hovered comment block */
export interface CommentBlockHoverInfo {
	/** The block position in the document */
	blockPos: number
	/** The comments associated with this block */
	comments: BlockComment[]
	/** Bounding rect of the block for positioning UI elements (viewport coordinates) */
	rect: DOMRect
}

export interface CommentGutterOptions {
	sourceMarkdown?: string
	onCommentClick?: (info: CommentClickInfo) => void
	/** Fired when any block is clicked (for adding new comments) */
	onBlockClick?: (info: BlockClickInfo) => void
	/** Fired when mouse enters/leaves a commented block (null = mouse left) */
	onCommentBlockHover?: (info: CommentBlockHoverInfo | null) => void
}

export const CommentGutter = Extension.create<CommentGutterOptions>({
	name: 'commentGutter',

	addOptions() {
		return {
			sourceMarkdown: undefined,
			onCommentClick: undefined,
			onBlockClick: undefined,
			onCommentBlockHover: undefined,
		}
	},

	addProseMirrorPlugins() {
		const { sourceMarkdown, onCommentClick, onBlockClick, onCommentBlockHover } = this.options

		return [
			new Plugin({
				key: commentGutterPluginKey,
				state: {
					init(_, state) {
						return { ...buildCommentData(state, []), pendingBlockPos: null as number | null }
					},
					apply(tr, prev, _oldState, newState) {
						// Check if external comments were updated via meta
						const externalUpdate = tr.getMeta(
							EXTERNAL_COMMENTS_META,
						) as ExternalBlockComment[] | undefined
						const externals =
							externalUpdate ?? prev.externalComments

						const pendingUpdate = tr.getMeta(PENDING_HIGHLIGHT_META) as number | null | undefined
						const pendingBlockPos = pendingUpdate !== undefined ? pendingUpdate : prev.pendingBlockPos

						if (!tr.docChanged && !externalUpdate && pendingUpdate === undefined) return prev

						const result = buildCommentData(newState, externals)

						if (pendingBlockPos !== null) {
							const node = newState.doc.nodeAt(pendingBlockPos)
							if (node) {
								result.decorationSet = result.decorationSet.add(newState.doc, [
									Decoration.node(pendingBlockPos, pendingBlockPos + node.nodeSize, {
										class: 'pending-comment',
									}),
								])
							}
						}

						return { ...result, pendingBlockPos }
					},
				},
				view(editorView) {
					// DOM event delegation for hover on .has-comments elements
					let lastHoveredBlockPos: number | null = null

					const handleMouseOver = (event: MouseEvent) => {
						if (!onCommentBlockHover) return
						const target = event.target as HTMLElement
						const commentBlock = target.closest('.has-comments')
						if (!commentBlock) return

						// Find the block position from DOM
						const pos = editorView.posAtDOM(commentBlock, 0)
						if (pos == null) return

						// Get the block node position
						const resolved = editorView.state.doc.resolve(pos)
						let blockDepth = resolved.depth
						while (blockDepth > 0 && !resolved.node(blockDepth).isBlock) {
							blockDepth--
						}
						if (blockDepth === 0) return

						const blockPos = resolved.before(blockDepth)

						// Skip if we're still in the same block (intra-block child transitions)
						if (blockPos === lastHoveredBlockPos) return
						lastHoveredBlockPos = blockPos

						const pluginState = commentGutterPluginKey.getState(editorView.state)
						if (!pluginState) return

						const block = pluginState.commentedBlocks.find((b) => b.blockPos === blockPos)
						if (!block) return

						const rect = commentBlock.getBoundingClientRect()
						onCommentBlockHover({
							blockPos,
							comments: block.comments,
							rect: new DOMRect(rect.left, rect.top, rect.width, rect.height),
						})
					}

					const handleMouseOut = (event: MouseEvent) => {
						if (!onCommentBlockHover) return
						const target = event.target as HTMLElement
						const relatedTarget = event.relatedTarget as HTMLElement | null

						// Check if we're leaving a .has-comments element
						const leavingBlock = target.closest('.has-comments')
						if (!leavingBlock) return

						// Check if we're entering another .has-comments element (nested case)
						const enteringBlock = relatedTarget?.closest('.has-comments')
						if (enteringBlock === leavingBlock) return

						// Phantom mouseout: when a hover overlay opens on top of a large block
						// (e.g. a mermaid SVG), the topmost element under a stationary cursor
						// changes, so the browser fires a mouseout from the block even though
						// the cursor never actually left it. Without this guard, the overlay
						// triggers a hide → re-show loop that blinks the comment preview.
						const rect = leavingBlock.getBoundingClientRect()
						if (
							event.clientX >= rect.left &&
							event.clientX < rect.right &&
							event.clientY >= rect.top &&
							event.clientY < rect.bottom
						) {
							return
						}

						// If entering a different comment block, the mouseover will fire
						// If leaving entirely, fire null
						if (!enteringBlock) {
							lastHoveredBlockPos = null
							onCommentBlockHover(null)
						}
					}

					editorView.dom.addEventListener('mouseover', handleMouseOver)
					editorView.dom.addEventListener('mouseout', handleMouseOut)

					return {
						destroy() {
							editorView.dom.removeEventListener('mouseover', handleMouseOver)
							editorView.dom.removeEventListener('mouseout', handleMouseOut)
						},
					}
				},
				props: {
					decorations(state) {
						return (
							commentGutterPluginKey.getState(state)
								?.decorationSet ?? DecorationSet.empty
						)
					},

					handleClick(view, pos) {
						const resolved = view.state.doc.resolve(pos)

						// Walk up to find the nearest block node
						let blockDepth = resolved.depth
						while (
							blockDepth > 0 &&
							!resolved.node(blockDepth).isBlock
						) {
							blockDepth--
						}
						if (blockDepth === 0) return false

						let blockPos = resolved.before(blockDepth)
						let blockNode = resolved.node(blockDepth)

						// If we landed on a listItem (e.g. clicking padding area),
						// drill down to its first paragraph child
						if (blockNode.type.name === 'listItem' || blockNode.type.name === 'taskItem') {
							const firstChild = blockNode.firstChild
							if (firstChild?.type.name === 'paragraph') {
								blockPos = blockPos + 1
								blockNode = firstChild
							}
						}

						// Find previous and next block text for context-based anchoring
						let previousBlockText: string | null = null
						let nextBlockText: string | null = null
						const doc = view.state.doc

						// Collect all top-level blocks to find prev/next
						const blocks: { pos: number; text: string }[] = []
						doc.forEach((node, offset) => {
							if (node.isBlock) {
								blocks.push({ pos: offset, text: node.textContent })
							}
						})

						const currentIdx = blocks.findIndex((b) => b.pos === blockPos)
						if (currentIdx > 0) {
							previousBlockText = blocks[currentIdx - 1]!.text
						}
						if (currentIdx >= 0 && currentIdx < blocks.length - 1) {
							nextBlockText = blocks[currentIdx + 1]!.text
						}

						const getBlockRect = () => {
							// Prefer the node's actual DOM rect over coordsAtPos: NodeViews
							// without a contentDOM (e.g. mermaid code blocks that render an
							// SVG instead of NodeViewContent) return incorrect coords for
							// positions inside the node, sending floating UI to the
							// top-left corner of the viewport.
							const dom = view.nodeDOM(blockPos)
							if (dom instanceof HTMLElement) {
								return dom.getBoundingClientRect()
							}
							const coords = view.coordsAtPos(blockPos + 1)
							const endCoords = view.coordsAtPos(blockPos + blockNode.nodeSize - 1)
							return new DOMRect(
								coords.left,
								coords.top,
								endCoords.right - coords.left,
								endCoords.bottom - coords.top,
							)
						}

						// If the block already has comments and onCommentClick is set, show them
						if (onCommentClick) {
							const pluginState =
								commentGutterPluginKey.getState(view.state)
							if (pluginState) {
								const block =
									pluginState.commentedBlocks.find(
										(b) => b.blockPos === blockPos,
									)
								if (block) {
									const firstComment = block.comments[0]
									if (firstComment === undefined) {
										throw new Error('invariant: commented block has no comments')
									}
									const lineNumber = firstComment.lineNumber
									const markdown = sourceMarkdown
										? getMarkdownLineAt(
												sourceMarkdown,
												lineNumber,
											)
										: ''
									onCommentClick({
										markdown,
										lineNumber,
										comments: block.comments,
										rect: getBlockRect(),
									})
									return true
								}
							}
						}

						// Otherwise, fire onBlockClick for adding new comments
						if (onBlockClick) {
							onBlockClick({
								blockPos,
								nodeType: blockNode.type.name,
								textContent: blockNode.textContent,
								previousBlockText,
								nextBlockText,
								rect: getBlockRect(),
							})
							return true
						}

						return false
					},
				},
			}),
		]
	},
})

/** Read the current commented blocks from the plugin state */
export function getCommentedBlocks(state: EditorState): CommentedBlock[] {
	return commentGutterPluginKey.getState(state)?.commentedBlocks ?? []
}

/**
 * Dispatch external block comments into the plugin.
 * Call this when block-level comments change (added/removed).
 */
export function setExternalBlockComments(
	view: { state: EditorState; dispatch: (tr: Transaction) => void },
	comments: ExternalBlockComment[],
) {
	const tr = view.state.tr
	tr.setMeta(EXTERNAL_COMMENTS_META, comments)
	view.dispatch(tr)
}

/**
 * Set or clear the pending highlight block.
 * Call with a blockPos to highlight, or null to clear.
 */
export function setPendingHighlightBlock(
	view: { state: EditorState; dispatch: (tr: Transaction) => void },
	blockPos: number | null,
) {
	const tr = view.state.tr
	tr.setMeta(PENDING_HIGHLIGHT_META, blockPos)
	view.dispatch(tr)
}
