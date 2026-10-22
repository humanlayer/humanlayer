/**
 * Artifact Viewer V2 owns its own anchor contract. The envelope below is what
 * `artifact_comments.anchor_json` stores (runtime-validated by
 * `AnchorV2Schema` in the riptide API contract; these types must stay
 * structurally identical to that schema). It is independent of the V1 triplet
 * columns even though it carries the same *kind* of block text/context
 * evidence for re-anchoring — V2 never reads or writes the legacy triplet.
 */

/**
 * One endpoint of a V2 anchor: a full content fingerprint of the target block
 * plus a character offset into that block's rendered text.
 *
 * The fingerprint is intentionally redundant (own text, both neighbors, node
 * type) so resolution can score duplicate candidates instead of accepting the
 * first text match. Atoms (images, horizontal rules) have empty `blockText`;
 * they are fingerprinted by `blockType` plus the neighboring block texts.
 */
export interface BlockPoint {
	/** ProseMirror node type name of the block (`paragraph`, `heading`, `image`, …). */
	blockType: string
	/** Rendered `textContent` of the block (empty for atoms). */
	blockText: string
	/** Rendered text of the previous commentable block (null if first block). */
	previousBlockText: string | null
	/** Rendered text of the next commentable block (null if last block). */
	nextBlockText: string | null
	/** Character offset into `blockText`. */
	offset: number
}

/**
 * Versioned V2 anchor envelope.
 *
 * `scope` records authored intent as a discriminant, not a rendering hint:
 * whole-block recovery during resolution is valid only for an anchor authored
 * as `'block'` — a failed precise `'range'` anchor must become Outdated, never
 * degrade to a whole-block highlight. Phase 4 authors only `'block'` anchors
 * (offsets `0 … blockText.length` spanning the selected block); `'range'` is
 * the reserved shape for precise selections.
 */
export interface AnchorV2 {
	v: 2
	scope: 'block' | 'range'
	/** Exact selected text; equals the whole block text for `scope: 'block'`. */
	selectedText: string
	start: BlockPoint
	end: BlockPoint
}

/**
 * Result of resolving a persisted anchor against the live document.
 *
 * - `resolved`: the anchor verifiably maps to `[from, to)` ProseMirror
 *   positions in the current document (for a whole-block anchor this is the
 *   block node's own range, suitable for a node decoration).
 * - `outdated`: no candidate could be verified. The comment stays visible in
 *   the review surfaces with an Outdated label but receives no document
 *   decoration; re-anchoring is intentionally out of scope.
 */
export type AnchorPlacement =
	| { status: 'resolved'; from: number; to: number }
	| { status: 'outdated' }

/**
 * Best-effort location for an Outdated anchor, recovered from the saved
 * neighboring block text. It names a current block boundary, never a text
 * range: the marker sits immediately `after` or `before` the block at
 * `blockPos`. It is recomputed against the live document on every projection
 * and never rewrites the stored anchor.
 */
export interface ApproximateAnchorHint {
	/** Absolute ProseMirror position of the surviving neighbor block. */
	blockPos: number
	edge: 'after' | 'before'
}

/**
 * The typed review vocabulary. Re-exported from the shared database schema so
 * the UI, the riptide API `comments.create` contract, and the persisted column
 * stay in lockstep — the "manual-sync pact" is a single source of truth rather
 * than three parallel unions (see `artifact-comment-kind.ts`).
 */
export type { CommentKind } from '@humanlayer/db/zodschemas/artifact-comment-kind'
