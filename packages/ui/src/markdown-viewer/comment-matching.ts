/**
 * Shared block-matching algorithm for anchoring artifact comments to rendered
 * ProseMirror textblocks.
 *
 * A comment is anchored by a content fingerprint: the rendered text of the
 * commented-upon block plus the rendered text of the previous and next blocks
 * (for disambiguation when the same text appears more than once).
 *
 * Read/write trim symmetry: comment anchors are stored trimmed on write
 * (`sanitizeBlockText` in `apps/riptide-ui/src/actions/comments.ts` trims and
 * coerces empty to `null`). We therefore trim the live `block.text` (and the
 * prev/next context) here before comparison so a stored trimmed string still
 * matches a live block whose `node.textContent` carries leading/trailing
 * whitespace.
 *
 * This helper is intentionally pure (no ProseMirror imports) so it can be unit
 * tested in isolation and shared by `applyComments` (write side: drives
 * `addMark`/gutter routing) and the two `WiredArtifactViewer` matchers (read
 * side: drive `nodeDOM`/`coordsAtPos`). Callers keep their own divergent use of
 * the returned index.
 */

export interface MatchableBlock {
	/** ProseMirror position of the block (caller-defined origin — see note below). */
	pos: number
	/** Rendered text content of the block (`node.textContent`). */
	text: string
	/** ProseMirror node type name (e.g. `paragraph`, `codeBlock`). */
	nodeType: string
	/** `node.nodeSize` — boundary-correct content span basis. */
	nodeSize: number
}

export interface CommentAnchor {
	/** Stored (trimmed) rendered text of the commented-upon block. */
	commentedUponBlockText: string | null
	/** Stored (trimmed) rendered text of the previous block (`null` if first). */
	previousBlockText: string | null
	/** Stored (trimmed) rendered text of the next block (`null` if last). */
	nextBlockText: string | null
}

/** Trim a live block's text; returns `null` for null/whitespace-only so it
 *  compares equal to a stored `null` context (symmetric with `sanitizeBlockText`). */
function normalize(text: string | null | undefined): string | null {
	const trimmed = text?.trim()
	return trimmed ? trimmed : null
}

/**
 * Find the index into `blocks` of the block that best matches `anchor`, using
 * the stored block text plus previous/next context for tie-breaking. Returns
 * `-1` when no block's text matches the anchor's commented-upon text.
 */
export function matchCommentToBlock(blocks: MatchableBlock[], anchor: CommentAnchor): number {
	const target = normalize(anchor.commentedUponBlockText)
	if (target === null) return -1

	let bestIdx = -1
	let bestScore = 0

	for (let i = 0; i < blocks.length; i++) {
		const blockText = normalize(blocks[i]!.text)
		// Primary match: textContent must match
		if (blockText !== target) continue

		let score = 1 // Base score for text match

		// Bonus for previous block match
		const prevText = i > 0 ? normalize(blocks[i - 1]!.text) : null
		if (anchor.previousBlockText === prevText) {
			score += 2 // Includes the "both null = first block" case
		}

		// Bonus for next block match
		const nextText = i < blocks.length - 1 ? normalize(blocks[i + 1]!.text) : null
		if (anchor.nextBlockText === nextText) {
			score += 2 // Includes the "both null = last block" case
		}

		if (score > bestScore) {
			bestScore = score
			bestIdx = i
		}
	}

	return bestIdx
}
