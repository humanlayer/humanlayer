import { blockOffsetToPos, type AnchorBlock } from './block-text-offsets'
import type { BlockPoint } from './types'

/**
 * Candidate enumeration and scoring for V2 anchor resolution.
 *
 * Resolution never accepts "the first block whose text matches": every
 * matching block in the document is enumerated, scored against the anchor's
 * stored block + neighboring-context evidence, and the winner must be
 * deterministic. Ties on score break by document order (earliest position),
 * which is stable across reloads of the same document.
 */

/** Whitespace-normalize rendered text for drift-tolerant comparison. */
export function normalizeAnchorText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

/**
 * Fold typographic transforms (smart quotes/dashes/ellipses) back to their
 * plain-ASCII originals so a stored quote authored before a Typography pass —
 * or vice versa — still matches. Applied only in the normalized/transformed
 * search stage, never to the exact-offset verification.
 */
export function transformQuoteText(text: string): string {
	return normalizeAnchorText(
		text
			.replace(/[‘’‚‛]/g, "'")
			.replace(/[“”„‟]/g, '"')
			.replace(/[–—]/g, '-')
			.replace(/…/g, '...'),
	)
}

export interface ScoredBlockCandidate {
	/** Index into the anchor-block list. */
	index: number
	score: number
}

function contextScore(blocks: AnchorBlock[], index: number, point: BlockPoint): number {
	let score = 0
	const previousText = blocks[index - 1]?.text ?? null
	const nextText = blocks[index + 1]?.text ?? null
	// Exact neighbor agreement is strong evidence; normalized agreement still
	// counts (the neighbor merely reflowed), but less.
	if (previousText === point.previousBlockText) score += 4
	else if (
		previousText != null &&
		point.previousBlockText != null &&
		normalizeAnchorText(previousText) === normalizeAnchorText(point.previousBlockText)
	) {
		score += 2
	}
	if (nextText === point.nextBlockText) score += 4
	else if (
		nextText != null &&
		point.nextBlockText != null &&
		normalizeAnchorText(nextText) === normalizeAnchorText(point.nextBlockText)
	) {
		score += 2
	}
	return score
}

/**
 * Enumerate every block matching `matchesBlock`, scored by how well its
 * neighborhood agrees with the stored fingerprint. Returns candidates sorted
 * best-first (score descending, then document order). Callers own the match
 * predicate so exact and normalized/transformed passes stay separate, ordered
 * stages instead of one fuzzy search.
 */
export function findBlockCandidates(
	blocks: AnchorBlock[],
	point: BlockPoint,
	matchesBlock: (block: AnchorBlock) => boolean,
): ScoredBlockCandidate[] {
	const candidates: ScoredBlockCandidate[] = []
	for (let index = 0; index < blocks.length; index++) {
		const block = blocks[index]!
		if (block.type !== point.blockType) continue
		if (!matchesBlock(block)) continue
		candidates.push({ index, score: contextScore(blocks, index, point) })
	}
	candidates.sort((a, b) => b.score - a.score || a.index - b.index)
	return candidates
}

/** A quote located across one or more blocks, ready to map back to PM positions. */
export interface QuoteRangeMatch {
	from: number
	to: number
	startBlockIndex: number
}

interface CharOwner {
	blockIndex: number
	/** Character offset into that block's `textContent`. */
	offset: number
}

/**
 * Flatten the block list into one searchable string plus a per-character owner
 * map back to `(blockIndex, offset)`. Blocks are joined by a single `\n`, which
 * both mirrors {@link pmTextBetween}'s block separator and lets a multi-block
 * quote match contiguously. The separator character is owned by the *end* of
 * the preceding block so a match that lands on it maps to a real block offset.
 */
function buildBlockConcat(blocks: AnchorBlock[]): { text: string; owners: CharOwner[] } {
	let text = ''
	const owners: CharOwner[] = []
	blocks.forEach((block, blockIndex) => {
		if (blockIndex > 0) {
			// Separator owned by the previous block's trailing edge.
			owners.push({ blockIndex: blockIndex - 1, offset: blocks[blockIndex - 1]!.text.length })
			text += '\n'
		}
		for (let i = 0; i < block.text.length; i++) {
			owners.push({ blockIndex, offset: i })
			text += block.text[i]
		}
	})
	return { text, owners }
}

/** Collapse whitespace runs to one space, keeping a map back to original indices. */
function normalizeWithMap(text: string): { text: string; map: number[] } {
	let out = ''
	const map: number[] = []
	let inRun = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!
		if (/\s/.test(ch)) {
			if (!inRun && out.length > 0) {
				out += ' '
				map.push(i)
			}
			inRun = true
		} else {
			out += ch
			map.push(i)
			inRun = false
		}
	}
	// Trim a trailing space produced by a run at the end.
	if (out.endsWith(' ')) {
		out = out.slice(0, -1)
		map.pop()
	}
	return { text: out, map }
}

/**
 * Find every occurrence of a needle in a haystack (exact substring), returning
 * flat start indices.
 */
function allIndicesOf(haystack: string, needle: string): number[] {
	const hits: number[] = []
	if (needle.length === 0) return hits
	let from = 0
	for (;;) {
		const idx = haystack.indexOf(needle, from)
		if (idx === -1) break
		hits.push(idx)
		from = idx + 1
	}
	return hits
}

/**
 * Locate a stored quote across the block list and map it back to PM positions.
 * Runs plannotator's ordered fallback: exact substring, then
 * whitespace-normalized, then typographic-transform-normalized. Every
 * occurrence is scored by how well the containing start block's neighborhood
 * agrees with the stored `start` fingerprint — a duplicate quote is never taken
 * by first-match. Ties break by document order.
 *
 * Returns null when no occurrence exists in any stage (the caller reports
 * Outdated — a failed precise range is never floored to a whole block).
 */
export function findQuoteRange(blocks: AnchorBlock[], selectedText: string, startPoint: BlockPoint): QuoteRangeMatch | null {
	if (selectedText.length === 0) return null
	const concat = buildBlockConcat(blocks)

	// Stage A — exact substring in the raw concatenated text.
	const exact = pickQuoteOccurrence(blocks, concat, allIndicesOf(concat.text, selectedText), selectedText.length, startPoint)
	if (exact) return exact

	// Stage B — whitespace-normalized search, indices mapped back through the map.
	const normalizedHaystack = normalizeWithMap(concat.text)
	const normalizedNeedle = normalizeAnchorText(selectedText)
	const normalized = pickNormalizedOccurrence(blocks, concat, normalizedHaystack, normalizedNeedle, startPoint)
	if (normalized) return normalized

	// Stage C — typographic transforms folded (smart quotes/dashes) on both sides.
	const transformedHaystack = normalizeWithMap(concat.text)
	const transformedNeedle = transformQuoteText(selectedText)
	// Re-normalize the haystack text through the transform for parity.
	const transformedHay = { text: transformQuoteText(transformedHaystack.text), map: transformedHaystack.map }
	if (transformedHay.text === transformedHaystack.text.replace(/\s+/g, ' ').trim()) {
		// No typographic characters present — Stage C is identical to Stage B.
		return null
	}
	return pickNormalizedOccurrence(blocks, concat, transformedHay, transformedNeedle, startPoint)
}

function pickQuoteOccurrence(
	blocks: AnchorBlock[],
	concat: { text: string; owners: CharOwner[] },
	flatStarts: number[],
	length: number,
	startPoint: BlockPoint,
): QuoteRangeMatch | null {
	let best: { match: QuoteRangeMatch; score: number; flatStart: number } | null = null
	for (const flatStart of flatStarts) {
		const match = mapFlatRange(blocks, concat, flatStart, flatStart + length)
		if (!match) continue
		const score = contextScore(blocks, match.startBlockIndex, startPoint)
		if (!best || score > best.score || (score === best.score && flatStart < best.flatStart)) {
			best = { match, score, flatStart }
		}
	}
	return best?.match ?? null
}

function pickNormalizedOccurrence(
	blocks: AnchorBlock[],
	concat: { text: string; owners: CharOwner[] },
	normalizedHaystack: { text: string; map: number[] },
	normalizedNeedle: string,
	startPoint: BlockPoint,
): QuoteRangeMatch | null {
	if (normalizedNeedle.length === 0) return null
	const hits = allIndicesOf(normalizedHaystack.text, normalizedNeedle)
	let best: { match: QuoteRangeMatch; score: number; flatStart: number } | null = null
	for (const hit of hits) {
		const flatStart = normalizedHaystack.map[hit]
		const flatEnd = normalizedHaystack.map[hit + normalizedNeedle.length - 1]
		if (flatStart == null || flatEnd == null) continue
		const match = mapFlatRange(blocks, concat, flatStart, flatEnd + 1)
		if (!match) continue
		const score = contextScore(blocks, match.startBlockIndex, startPoint)
		if (!best || score > best.score || (score === best.score && flatStart < best.flatStart)) {
			best = { match, score, flatStart }
		}
	}
	return best?.match ?? null
}

/** Map a `[flatStart, flatEnd)` range in the concatenated text to PM positions. */
function mapFlatRange(
	blocks: AnchorBlock[],
	concat: { text: string; owners: CharOwner[] },
	flatStart: number,
	flatEnd: number,
): QuoteRangeMatch | null {
	const startOwner = concat.owners[flatStart]
	const endOwner = concat.owners[flatEnd - 1]
	if (!startOwner || !endOwner) return null
	const startBlock = blocks[startOwner.blockIndex]
	const endBlock = blocks[endOwner.blockIndex]
	if (!startBlock || !endBlock) return null
	const from = blockOffsetToPos(startBlock, startOwner.offset)
	const to = blockOffsetToPos(endBlock, endOwner.offset + 1)
	if (to <= from) return null
	return { from, to, startBlockIndex: startOwner.blockIndex }
}
