import type { AnchorBlock } from './block-text-offsets'
import { blockOffsetToPos, wholeBlockPmRange } from './block-text-offsets'
import { findBlockCandidates, findQuoteRange, normalizeAnchorText } from './doc-text-search'
import type { AnchorPlacement, AnchorV2, ApproximateAnchorHint, BlockPoint } from './types'

/**
 * Structural guard for the persisted `anchor_json` value. Returns the typed
 * envelope only for a well-formed V2 anchor; legacy rows (null / undefined /
 * the V1 triplet lives in its own columns, never here) and unknown shapes
 * return null and are OUTSIDE the resolver's input contract — desktop V2 does
 * not resolve legacy comments and has no null-anchor fallback path.
 */
export function parseAnchorV2(value: unknown): AnchorV2 | null {
	if (typeof value !== 'object' || value === null) return null
	const anchor = value as Partial<AnchorV2>
	if (anchor.v !== 2) return null
	if (anchor.scope !== 'block' && anchor.scope !== 'range') return null
	if (typeof anchor.selectedText !== 'string') return null
	if (!isBlockPoint(anchor.start) || !isBlockPoint(anchor.end)) return null
	return anchor as AnchorV2
}

function isBlockPoint(value: unknown): value is BlockPoint {
	if (typeof value !== 'object' || value === null) return false
	const point = value as Partial<BlockPoint>
	return (
		typeof point.blockType === 'string' &&
		typeof point.blockText === 'string' &&
		(point.previousBlockText === null || typeof point.previousBlockText === 'string') &&
		(point.nextBlockText === null || typeof point.nextBlockText === 'string') &&
		typeof point.offset === 'number'
	)
}

/**
 * Resolve a V2 anchor against the live document's anchor blocks using
 * ordered, verified passes. For a whole-block anchor:
 *
 * 1. **Exact**: blocks whose rendered text equals the stored block text
 *    (moved blocks are found here too — the search is document-wide and
 *    context evidence scores duplicate candidates instead of a first-match
 *    shortcut).
 * 2. **Normalized**: blocks whose whitespace-normalized text equals the
 *    normalized stored text (local drift within the block).
 * 3. **Outdated**: nothing verifiable — the thread stays visible with an
 *    Outdated label and no document decoration.
 *
 * Whole-block placement is legal for a `scope: 'block'` anchor *because* it was
 * authored as whole-block. A precise `scope: 'range'` anchor resolves to its
 * exact inline range through {@link resolveRangeAnchor}; when its quote can no
 * longer be verified anywhere it reports Outdated — it is never floored to a
 * whole block it never described.
 */
export function resolveAnchor(blocks: AnchorBlock[], anchor: AnchorV2): AnchorPlacement {
	if (anchor.scope === 'range') return resolveRangeAnchor(blocks, anchor)
	return resolveWholeBlockAnchor(blocks, anchor)
}

/**
 * Resolve a precise `range` anchor through the ordered, verified chain:
 *
 * 1. **Precise** — the stored start/end block fingerprints still exist and the
 *    stored offsets reproduce the stored quote exactly. Duplicate blocks are
 *    disambiguated by neighboring context, never first-match.
 * 2. **Scored quote search** — the offsets drifted or the blocks were edited;
 *    locate the exact quote across the document, scored by the start block's
 *    context ({@link findQuoteRange} stage A).
 * 3. **Normalized / transformed search** — whitespace or typographic changes;
 *    same scored search over normalized text ({@link findQuoteRange} stages
 *    B/C).
 * 4. **Outdated** — the quote is gone; no whole-block degradation.
 */
export function resolveRangeAnchor(blocks: AnchorBlock[], anchor: AnchorV2): AnchorPlacement {
	const precise = resolvePreciseRange(blocks, anchor)
	if (precise) return precise

	const found = findQuoteRange(blocks, anchor.selectedText, anchor.start)
	if (found) return { status: 'resolved', from: found.from, to: found.to }

	return { status: 'outdated' }
}

/**
 * Stage 1: the stored block fingerprints and offsets still reproduce the stored
 * quote exactly. Enumerates every start/end fingerprint match (scored by
 * context), pairs an end candidate at or after the start, and accepts only when
 * the reconstructed slice's normalized text equals the stored quote.
 */
function resolvePreciseRange(blocks: AnchorBlock[], anchor: AnchorV2): AnchorPlacement | null {
	const startCandidates = findBlockCandidates(blocks, anchor.start, (block) => block.text === anchor.start.blockText)
	const endCandidates = findBlockCandidates(blocks, anchor.end, (block) => block.text === anchor.end.blockText)
	const target = normalizeAnchorText(anchor.selectedText)

	for (const startCandidate of startCandidates) {
		const startBlock = blocks[startCandidate.index]
		if (!startBlock) continue
		// End must sit at or after the start block; prefer the best-scored such
		// candidate, falling back to the overall best when none follows.
		const endCandidate =
			endCandidates.find((candidate) => candidate.index >= startCandidate.index) ?? endCandidates[0]
		if (!endCandidate) continue
		const endBlock = blocks[endCandidate.index]
		if (!endBlock) continue
		const from = blockOffsetToPos(startBlock, anchor.start.offset)
		const to = blockOffsetToPos(endBlock, anchor.end.offset)
		if (to <= from) continue
		const reconstructed = reconstructQuote(blocks, startCandidate.index, anchor.start.offset, endCandidate.index, anchor.end.offset)
		if (normalizeAnchorText(reconstructed) === target) {
			return { status: 'resolved', from, to }
		}
	}
	return null
}

/**
 * Rebuild the quote a stored range describes from the block texts, using a
 * `\n` block separator to match {@link pmTextBetween}. Compared only after
 * normalization, so the separator choice never affects acceptance.
 */
function reconstructQuote(
	blocks: AnchorBlock[],
	startIndex: number,
	startOffset: number,
	endIndex: number,
	endOffset: number,
): string {
	if (startIndex === endIndex) {
		return blocks[startIndex]?.text.slice(startOffset, endOffset) ?? ''
	}
	const parts: string[] = [blocks[startIndex]?.text.slice(startOffset) ?? '']
	for (let i = startIndex + 1; i < endIndex; i++) parts.push(blocks[i]?.text ?? '')
	parts.push(blocks[endIndex]?.text.slice(0, endOffset) ?? '')
	return parts.join('\n')
}

function resolveWholeBlockAnchor(blocks: AnchorBlock[], anchor: AnchorV2): AnchorPlacement {
	const point = anchor.start
	const storedText = point.blockText

	// Pass 1 — exact stored block text (verifies the stored quote too: for a
	// block anchor the quote *is* the block text).
	const exact = pickCandidate(
		blocks,
		point,
		(block) => block.text === storedText && block.text === anchor.selectedText,
	)
	if (exact) return { status: 'resolved', ...wholeBlockPmRange(exact) }

	// Pass 2 — normalized text (whitespace drift inside the block).
	const normalizedStored = normalizeAnchorText(storedText)
	if (normalizedStored.length > 0) {
		const normalized = pickCandidate(blocks, point, (block) => normalizeAnchorText(block.text) === normalizedStored)
		if (normalized) return { status: 'resolved', ...wholeBlockPmRange(normalized) }
	}

	return { status: 'outdated' }
}

/**
 * Pick the verified winner among matching blocks: best context score, then
 * earliest document position. Atoms carry no own-text evidence (`blockText`
 * is empty), so multiple atom candidates that also tie on zero context
 * agreement are genuinely indistinguishable — that is ambiguity, not a match,
 * and resolution reports Outdated instead of guessing.
 */
function pickCandidate(
	blocks: AnchorBlock[],
	point: BlockPoint,
	matchesBlock: (block: AnchorBlock) => boolean,
): AnchorBlock | null {
	const candidates = findBlockCandidates(blocks, point, matchesBlock)
	const best = candidates[0]
	if (!best) return null
	const runnerUp = candidates[1]
	const hasOwnTextEvidence = point.blockText.length > 0
	if (!hasOwnTextEvidence && best.score === 0 && runnerUp && runnerUp.score === 0) return null
	return blocks[best.index] ?? null
}

type NeighborMatch = { kind: 'missing' } | { kind: 'ambiguous' } | { kind: 'unique'; index: number }

/**
 * Locate one saved neighbor block in the current document. Exact text first,
 * then whitespace-normalized text; no fuzzy scoring. A duplicated match is
 * ambiguous evidence, not a missing neighbor, so callers never fall back to the
 * other neighbor when one side is ambiguous. Null boundary context and empty
 * text identify nothing.
 */
function matchNeighbor(blocks: AnchorBlock[], text: string | null): NeighborMatch {
	if (text == null || text.length === 0) return { kind: 'missing' }
	const pick = (matches: (block: AnchorBlock) => boolean): NeighborMatch => {
		let found: number | null = null
		for (let index = 0; index < blocks.length; index++) {
			if (!matches(blocks[index]!)) continue
			if (found != null) return { kind: 'ambiguous' }
			found = index
		}
		return found == null ? { kind: 'missing' } : { kind: 'unique', index: found }
	}
	const exact = pick((block) => block.text === text)
	if (exact.kind !== 'missing') return exact
	const normalized = normalizeAnchorText(text)
	if (normalized.length === 0) return { kind: 'missing' }
	return pick((block) => normalizeAnchorText(block.text) === normalized)
}

/**
 * Best-effort location for an anchor whose own text no longer resolves, from
 * the blocks that surrounded it when it was saved: the block before its start
 * and the block after its end.
 *
 * - Both neighbors match uniquely, in order → after the preceding block (they
 *   need not stay adjacent; replacement content may sit between them).
 * - Only the preceding neighbor survives → after it.
 * - Only the following neighbor survives → before it.
 * - Ambiguous, reversed, or no surviving evidence → null (rail only).
 *
 * Callers use this only after exact recovery failed. It never yields a text
 * range and never rewrites the anchor.
 */
export function resolveApproximateAnchor(blocks: AnchorBlock[], anchor: AnchorV2): ApproximateAnchorHint | null {
	const previous = matchNeighbor(blocks, anchor.start.previousBlockText)
	const next = matchNeighbor(blocks, anchor.end.nextBlockText)
	if (previous.kind === 'ambiguous' || next.kind === 'ambiguous') return null
	if (previous.kind === 'unique') {
		if (next.kind === 'unique' && next.index <= previous.index) return null
		return { blockPos: blocks[previous.index]!.pos, edge: 'after' }
	}
	if (next.kind === 'unique') return { blockPos: blocks[next.index]!.pos, edge: 'before' }
	return null
}
