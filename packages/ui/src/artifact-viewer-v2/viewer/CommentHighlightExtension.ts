import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import type { CommentKind } from '../anchor/types'

/**
 * One resolved comment range keyed by its root comment. A range spanning a
 * whole block node renders as a node decoration; a precise inline range renders
 * as an inline decoration. `createdAt` breaks equal-span activation ties.
 */
export interface CommentHighlightRange {
	rootCommentId: string
	from: number
	to: number
	/** Root comment creation time (ms); used only for equal-span tie-breaks. */
	createdAt?: number
	/**
	 * Typed verdict of the root comment; drives a kind-specific decoration class
	 * (deletion red/strikethrough, approval green). Absent/`comment` is neutral.
	 */
	kind?: CommentKind
}

/** The in-flight (not-yet-persisted) selection range. */
export interface PendingHighlightRange {
	from: number
	to: number
}

export interface CommentHighlightState {
	ranges: CommentHighlightRange[]
	/** Root IDs with transient selected/hovered emphasis. */
	activeRootIds: ReadonlySet<string>
	/** The pending selection decoration, or null. */
	pending: PendingHighlightRange | null
}

interface CommentHighlightMeta {
	ranges?: CommentHighlightRange[]
	activeRootIds?: ReadonlySet<string>
	pending?: PendingHighlightRange | null
}

const commentHighlightPluginKey = new PluginKey<CommentHighlightState>('artifactViewerV2CommentHighlights')

/** Class applied to a whole block that carries at least one V2 comment. */
export const COMMENT_BLOCK_CLASS = 'artifact-viewer-v2-block-commented'
/** Class applied to a precise inline comment range. */
export const COMMENT_RANGE_CLASS = 'artifact-viewer-v2-range-commented'
/** Additional class while any of the range's threads is selected/hovered. */
export const COMMENT_ACTIVE_CLASS = 'artifact-viewer-v2-comment-active'
/** Class applied to the in-flight pending selection range. */
export const COMMENT_PENDING_CLASS = 'artifact-viewer-v2-range-pending'
/** Additional class for a deletion verdict (red tint + strikethrough). */
export const COMMENT_DELETION_CLASS = 'artifact-viewer-v2-comment-deletion'
/** Additional class for an approval verdict (green tint). */
export const COMMENT_APPROVAL_CLASS = 'artifact-viewer-v2-comment-approval'

/**
 * General view-only comment-decoration engine for Artifact Viewer V2, keyed by
 * resolved V2 anchors. Ranges live in plugin state (set via
 * {@link setCommentHighlights} after an anchor-resolution pass) and render as
 * decorations without ever mutating the ProseMirror document.
 *
 * A range spanning exactly one block node renders as a single node decoration
 * (multiple whole-block comments collapse into one block-level state); a
 * precise inline range renders as an inline decoration, and overlapping inline
 * ranges each render independently so every comment stays visible. A pending
 * selection renders as its own decoration. Unmatched / outdated comments are
 * simply never fed in as ranges.
 *
 * It is independent of the keyboard-focus decoration: both classes can land on
 * the same block and style independently.
 */
export const CommentHighlightExtension = Extension.create({
	name: 'artifactViewerV2CommentHighlights',

	addProseMirrorPlugins() {
		return [
			new Plugin<CommentHighlightState>({
				key: commentHighlightPluginKey,
				state: {
					init: () => ({ ranges: [], activeRootIds: new Set(), pending: null }),
					apply(tr, value) {
						const meta = tr.getMeta(commentHighlightPluginKey) as CommentHighlightMeta | undefined
						let next = value
						if (meta) {
							next = {
								ranges: meta.ranges ?? value.ranges,
								activeRootIds: meta.activeRootIds ?? value.activeRootIds,
								pending: meta.pending !== undefined ? meta.pending : value.pending,
							}
						}
						if (!tr.docChanged) return next
						const mapped: CommentHighlightRange[] = []
						for (const range of next.ranges) {
							const from = tr.mapping.mapResult(range.from)
							const to = tr.mapping.mapResult(range.to)
							if (from.deleted && to.deleted) continue
							if (to.pos <= from.pos) continue
							mapped.push({ ...range, from: from.pos, to: to.pos })
						}
						let pending = next.pending
						if (pending) {
							const from = tr.mapping.mapResult(pending.from)
							const to = tr.mapping.mapResult(pending.to)
							pending = to.pos <= from.pos ? null : { from: from.pos, to: to.pos }
						}
						return { ...next, ranges: mapped, pending }
					},
				},
				props: {
					decorations(state) {
						const highlight = commentHighlightPluginKey.getState(state)
						if (!highlight) return DecorationSet.empty
						if (highlight.ranges.length === 0 && !highlight.pending) return DecorationSet.empty

						// Group ranges that span exactly one whole block node so a block
						// with several root comments renders ONE block-level state.
						const wholeBlocks = new Map<number, { to: number; rootIds: string[]; kinds: Set<CommentKind> }>()
						const decorations: Decoration[] = []
						for (const range of highlight.ranges) {
							if (isWholeBlockRange(state, range.from, range.to)) {
								const existing = wholeBlocks.get(range.from)
								if (existing) {
									existing.rootIds.push(range.rootCommentId)
									if (range.kind) existing.kinds.add(range.kind)
								} else {
									wholeBlocks.set(range.from, {
										to: range.to,
										rootIds: [range.rootCommentId],
										kinds: new Set(range.kind ? [range.kind] : []),
									})
								}
								continue
							}
							decorations.push(
								Decoration.inline(range.from, range.to, {
									class: rangeClass(highlight.activeRootIds.has(range.rootCommentId), range.kind),
									'data-comment-root-ids': range.rootCommentId,
								}),
							)
						}
						for (const [from, block] of wholeBlocks) {
							const active = block.rootIds.some((id) => highlight.activeRootIds.has(id))
							decorations.push(
								Decoration.node(from, block.to, {
									class: blockClass(active, verdictKind(block.kinds)),
									'data-comment-root-ids': block.rootIds.join(','),
								}),
							)
						}
						if (highlight.pending) {
							const { from, to } = highlight.pending
							if (isWholeBlockRange(state, from, to)) {
								decorations.push(Decoration.node(from, to, { class: COMMENT_PENDING_CLASS }))
							} else {
								decorations.push(Decoration.inline(from, to, { class: COMMENT_PENDING_CLASS }))
							}
						}
						return DecorationSet.create(state.doc, decorations)
					},
				},
			}),
		]
	},
})

function isWholeBlockRange(state: EditorState, from: number, to: number): boolean {
	const node = state.doc.nodeAt(from)
	return node != null && node.isBlock && to === from + node.nodeSize
}

/** The extra kind class for a verdict, or empty for neutral `comment`. */
function kindClass(kind: CommentKind | undefined): string {
	if (kind === 'deletion') return COMMENT_DELETION_CLASS
	if (kind === 'approval') return COMMENT_APPROVAL_CLASS
	return ''
}

/**
 * The single verdict class for a collapsed whole-block group: a distinct
 * deletion/approval kind styles the block, but a block carrying a mix of
 * verdicts (or plain comments) stays neutral rather than picking arbitrarily.
 */
function verdictKind(kinds: Set<CommentKind>): CommentKind | undefined {
	const verdicts = [...kinds].filter((kind) => kind === 'deletion' || kind === 'approval')
	return verdicts.length === 1 ? verdicts[0] : undefined
}

function blockClass(active: boolean, kind?: CommentKind): string {
	return [COMMENT_BLOCK_CLASS, active ? COMMENT_ACTIVE_CLASS : '', kindClass(kind)].filter(Boolean).join(' ')
}

function rangeClass(active: boolean, kind?: CommentKind): string {
	return [COMMENT_RANGE_CLASS, active ? COMMENT_ACTIVE_CLASS : '', kindClass(kind)].filter(Boolean).join(' ')
}

/**
 * Deterministic overlap hit test: among ranges containing `pos`, pick the
 * smallest span; break equal-span ties by earliest creation time, then root ID.
 * Independent of decoration render order. Returns null when no range contains
 * the position.
 */
export function pickRangeAt(ranges: CommentHighlightRange[], pos: number): CommentHighlightRange | null {
	let best: CommentHighlightRange | null = null
	for (const range of ranges) {
		if (pos < range.from || pos >= range.to) continue
		if (!best) {
			best = range
			continue
		}
		const span = range.to - range.from
		const bestSpan = best.to - best.from
		if (span < bestSpan) {
			best = range
		} else if (span === bestSpan) {
			const createdAt = range.createdAt ?? Number.POSITIVE_INFINITY
			const bestCreatedAt = best.createdAt ?? Number.POSITIVE_INFINITY
			if (createdAt < bestCreatedAt || (createdAt === bestCreatedAt && range.rootCommentId < best.rootCommentId)) {
				best = range
			}
		}
	}
	return best
}

/** Replace the resolved comment ranges. Called after an anchor-resolution pass. */
export function setCommentHighlights(view: EditorView, ranges: CommentHighlightRange[]): void {
	const current = commentHighlightPluginKey.getState(view.state)
	const members = new Set(ranges.map((range) => range.rootCommentId))
	const activeRootIds = new Set([...(current?.activeRootIds ?? [])].filter((id) => members.has(id)))
	const meta: CommentHighlightMeta = { ranges, activeRootIds }
	view.dispatch(view.state.tr.setMeta(commentHighlightPluginKey, meta))
}

/** Replace ranges and active membership from one coherent projection snapshot. */
export function setCommentHighlightProjection(
	view: EditorView,
	ranges: CommentHighlightRange[],
	activeRootIds: Iterable<string>,
): void {
	const members = new Set(ranges.map((range) => range.rootCommentId))
	const active = new Set([...activeRootIds].filter((id) => members.has(id)))
	view.dispatch(view.state.tr.setMeta(commentHighlightPluginKey, { ranges, activeRootIds: active }))
}

/** Replace the transient selected/hovered root IDs. Called from user-event handlers. */
export function setActiveCommentHighlights(view: EditorView, rootIds: Iterable<string>): void {
	const meta: CommentHighlightMeta = { activeRootIds: new Set(rootIds) }
	view.dispatch(view.state.tr.setMeta(commentHighlightPluginKey, meta))
}

/** Set (or clear, with `null`) the pending selection decoration. */
export function setPendingHighlight(view: EditorView, pending: PendingHighlightRange | null): void {
	const meta: CommentHighlightMeta = { pending }
	view.dispatch(view.state.tr.setMeta(commentHighlightPluginKey, meta))
}

/** Read the current highlight state (ranges + active IDs + pending). */
export function getCommentHighlightState(state: EditorState): CommentHighlightState {
	return commentHighlightPluginKey.getState(state) ?? { ranges: [], activeRootIds: new Set(), pending: null }
}
