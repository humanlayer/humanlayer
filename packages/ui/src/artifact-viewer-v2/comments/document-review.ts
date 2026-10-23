import type { CommentKind } from '../anchor/types'
import type { NavigableBlock } from '../viewer/build-navigable-blocks'
import { pickRangeAt, type CommentHighlightRange } from '../viewer/CommentHighlightExtension'
import type { ProjectedCommentThread } from './project-comments'

export interface DocumentReviewFacts {
	gutterItems: Array<{
		blockPos: number
		rootCommentIds: string[]
		participants: ProjectedCommentThread['participants']
		anchorFrom?: number
		anchorTo?: number
	}>
	railRanges: Array<{ key: string; from: number; to: number; active: boolean }>
	/**
	 * Best-effort markers for open Outdated threads whose saved neighbor blocks
	 * survive. A marker sits at a block boundary and never highlights text.
	 */
	approximateMarkers: Array<{ key: string; blockPos: number; edge: 'after' | 'before'; rootCommentIds: string[] }>
}

export type DocumentReviewClick =
	| { kind: 'activate'; rootCommentId: string }
	| { kind: 'target-block'; block: NavigableBlock }
	| { kind: 'ignore' }

export function deriveDocumentReviewFacts(
	threads: ProjectedCommentThread[],
	blocks: NavigableBlock[],
	activeRootIds: ReadonlySet<string>,
): DocumentReviewFacts {
	const groups = new Map<
		number,
		DocumentReviewFacts['gutterItems'][number] & { from: number; to: number; whole: boolean }
	>()
	const railRanges: DocumentReviewFacts['railRanges'] = []
	const markers = new Map<string, DocumentReviewFacts['approximateMarkers'][number]>()
	for (const thread of threads) {
		if (thread.placement.status !== 'resolved') {
			const hint = thread.approximate
			if (!hint || !blocks.some((block) => block.pos === hint.blockPos)) continue
			const key = `${hint.blockPos}:${hint.edge}`
			const marker = markers.get(key)
			if (marker) marker.rootCommentIds.push(thread.root.id)
			else markers.set(key, { key, blockPos: hint.blockPos, edge: hint.edge, rootCommentIds: [thread.root.id] })
			continue
		}
		const { from, to } = thread.placement
		const block = blocks.find((candidate) => from >= candidate.pos && from < candidate.end)
		if (!block) continue
		const whole = from === block.pos && to === block.end
		if (!whole) railRanges.push({ key: thread.root.id, from, to, active: activeRootIds.has(thread.root.id) })
		const group = groups.get(block.pos)
		if (!group) {
			groups.set(block.pos, {
				blockPos: block.pos,
				rootCommentIds: [thread.root.id],
				participants: [...thread.participants],
				from,
				to,
				whole,
			})
			continue
		}
		group.rootCommentIds.push(thread.root.id)
		for (const participant of thread.participants) {
			if (!group.participants.some((candidate) => candidate.userId === participant.userId)) group.participants.push(participant)
		}
		group.from = Math.min(group.from, from)
		group.to = Math.max(group.to, to)
		group.whole ||= whole
	}
	const gutterItems = [...groups.values()].map(({ from, to, whole, ...item }) =>
		whole ? item : { ...item, anchorFrom: from, anchorTo: to },
	)
	return { gutterItems, railRanges, approximateMarkers: [...markers.values()] }
}

/**
 * Whether a typed verdict of `kind` already covers the target range. Instant
 * `d`/`a` is idempotent per kind: re-issuing the same verdict on a block (or
 * range) that already carries it is a no-op, so we never stack a second
 * identical verdict. Different-kind verdicts may still stack (a deleted block
 * can also be approved), so only same-kind overlaps count.
 */
export function verdictAlreadyPresent(
	highlights: readonly CommentHighlightRange[],
	target: { from: number; to: number },
	kind: CommentKind,
): boolean {
	return highlights.some(
		(highlight) => highlight.kind === kind && highlight.from < target.to && highlight.to > target.from,
	)
}

/** Pick the deterministic thread whose annotation fully covers a target. */
export function pickThreadCoveringTarget(
	highlights: readonly CommentHighlightRange[],
	target: { from: number; to: number },
): string | null {
	const covering = highlights.filter((highlight) => highlight.from <= target.from && highlight.to >= target.to)
	return pickRangeAt(covering, target.from)?.rootCommentId ?? null
}

export function decideDocumentReviewClick(
	pos: number,
	blocks: NavigableBlock[],
	highlights: CommentHighlightRange[],
): DocumentReviewClick {
	const match = pickRangeAt(highlights, pos)
	if (match) return { kind: 'activate', rootCommentId: match.rootCommentId }
	const block = blocks.find((candidate) => pos >= candidate.pos && pos < candidate.end)
	return block ? { kind: 'target-block', block } : { kind: 'ignore' }
}
