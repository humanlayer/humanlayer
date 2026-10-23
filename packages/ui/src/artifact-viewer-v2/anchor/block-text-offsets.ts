import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { buildNavigableBlocks, type NavigableBlock } from '../viewer/build-navigable-blocks'
import type { AnchorV2, BlockPoint } from './types'

/**
 * One run of block text mapped to a contiguous span of ProseMirror positions.
 *
 * A textblock's rendered `textContent` is the concatenation of its inline text
 * nodes; each such node occupies `length` consecutive PM positions starting at
 * `pmStart`, but the character offset (`charStart`) into `textContent` skips
 * inline atoms that contribute no text. The segment list makes the offset↔PM
 * mapping *exact* — offsets are never proportionally interpolated from node
 * size.
 */
export interface CharSegment {
	/** Character offset into the block's `textContent` where this run starts. */
	charStart: number
	/** Absolute PM position of the run's first character. */
	pmStart: number
	/** Number of characters (and PM positions) in the run. */
	length: number
}

/**
 * A commentable block enriched with the rendered text the anchor contract
 * fingerprints plus the exact char→PM segment map. The block universe is
 * exactly the keyboard-navigation model (`buildNavigableBlocks`): every
 * textblock plus block atoms, in document order, with viewer chrome excluded —
 * so anchors and keyboard targets can never disagree about what a "block" is.
 */
export interface AnchorBlock extends Omit<NavigableBlock, 'sectionId'> {
	/** Rendered `textContent` of the block (empty for atoms). */
	text: string
	/** Char→PM segment map over the block's inline content. */
	segments: CharSegment[]
}

/**
 * Flatten a block node's inline content into its rendered text plus a char→PM
 * segment map, in one walk so char offsets always align with the text.
 *
 * - Text nodes contribute their characters mapped to consecutive positions.
 * - Hard breaks contribute a single `\n` (matching the rendered `innerText`
 *   visual line break) mapped to their one PM position.
 * - Other inline atoms (inline math, …) advance the PM position by their node
 *   size without contributing text, matching `node.textContent`.
 * - Wrapper nodes are recursed into (mirrors the V1 `collectTextSegments`).
 *
 * Offsets are exact — never proportionally interpolated from node size.
 */
function buildBlockContent(node: ProseMirrorNode, contentStart: number): { text: string; segments: CharSegment[] } {
	let text = ''
	const segments: CharSegment[] = []
	const walk = (parent: ProseMirrorNode, base: number) => {
		let offset = 0
		parent.content.forEach((child) => {
			const childPos = base + offset
			if (child.isText && child.text) {
				segments.push({ charStart: text.length, pmStart: childPos, length: child.text.length })
				text += child.text
			} else if (child.type.name === 'hardBreak') {
				segments.push({ charStart: text.length, pmStart: childPos, length: 1 })
				text += '\n'
			} else if (child.content.size > 0) {
				// Recurse into wrappers; childPos + 1 skips the open token.
				walk(child, childPos + 1)
			}
			offset += child.nodeSize
		})
	}
	walk(node, contentStart)
	return { text, segments }
}

/**
 * Collect the ordered anchor-block list from the live document. This is the
 * shared input for anchor creation ({@link createWholeBlockAnchor},
 * {@link createRangeAnchor}) and resolution (`resolveAnchor`).
 */
export function collectAnchorBlocks(doc: ProseMirrorNode): AnchorBlock[] {
	// An empty outline is fine here: only the section assignment consumes it,
	// and AnchorBlock drops `sectionId`.
	return buildNavigableBlocks(doc, []).map(({ sectionId: _sectionId, ...block }) => {
		const node = doc.nodeAt(block.pos)
		const content = node ? buildBlockContent(node, block.pos + 1) : { text: '', segments: [] }
		return { ...block, text: content.text, segments: content.segments }
	})
}

/**
 * Map a character offset within a block's `textContent` to its absolute PM
 * position, using the exact segment map. Offsets at the end of a run resolve to
 * the run's trailing position; an empty block (no segments) resolves to the
 * block's content start.
 */
export function blockOffsetToPos(block: AnchorBlock, offset: number): number {
	for (const seg of block.segments) {
		if (offset >= seg.charStart && offset <= seg.charStart + seg.length) {
			return seg.pmStart + (offset - seg.charStart)
		}
	}
	const last = block.segments[block.segments.length - 1]
	if (last && offset > last.charStart + last.length) return last.pmStart + last.length
	return block.pos + 1
}

/**
 * Inverse of {@link blockOffsetToPos}: map an absolute PM position inside a
 * block to its character offset into the block's `textContent`.
 */
export function posToBlockOffset(block: AnchorBlock, pos: number): number {
	for (const seg of block.segments) {
		if (pos >= seg.pmStart && pos <= seg.pmStart + seg.length) {
			return seg.charStart + (pos - seg.pmStart)
		}
	}
	const last = block.segments[block.segments.length - 1]
	if (last && pos > last.pmStart + last.length) return last.charStart + last.length
	return 0
}

function blockPointAt(blocks: AnchorBlock[], index: number, offset: number): BlockPoint {
	const block = blocks[index]
	if (!block) throw new RangeError(`No anchor block at index ${index}`)
	return {
		blockType: block.type,
		blockText: block.text,
		previousBlockText: blocks[index - 1]?.text ?? null,
		nextBlockText: blocks[index + 1]?.text ?? null,
		offset,
	}
}

/**
 * Create a whole-block V2 anchor for the block at `index`: start/end carry the
 * same fingerprint with offsets spanning the entire rendered block text, and
 * `selectedText` is the exact block text. This remains an EXPLICIT operation —
 * a collapsed text selection is not silently reinterpreted as a whole-block
 * target ({@link createRangeAnchor} returns null for a collapsed range).
 */
export function createWholeBlockAnchor(blocks: AnchorBlock[], index: number): AnchorV2 {
	const block = blocks[index]
	if (!block) throw new RangeError(`No anchor block at index ${index}`)
	return {
		v: 2,
		scope: 'block',
		selectedText: block.text,
		start: blockPointAt(blocks, index, 0),
		end: blockPointAt(blocks, index, block.text.length),
	}
}

/**
 * Serialized text between two positions with a `\n` at each block boundary and
 * at each hard break, matching {@link collectAnchorBlocks}'s block text so
 * precise resolution can reconstruct and compare the stored quote. Non-break
 * inline atoms contribute nothing (as in `textContent`).
 */
export function pmTextBetween(doc: ProseMirrorNode, from: number, to: number): string {
	return doc.textBetween(from, to, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''))
}

/**
 * Create a precise `range` anchor for the exact PM selection `[from, to)`. The
 * endpoints may live in the same block or in different blocks (a first-class
 * multi-block range, not clamped). Returns null for a collapsed selection or a
 * selection whose endpoints do not fall inside commentable textblocks — a
 * collapsed target must be created explicitly via {@link createWholeBlockAnchor}.
 */
export function createRangeAnchor(doc: ProseMirrorNode, from: number, to: number): AnchorV2 | null {
	const lo = Math.min(from, to)
	const hi = Math.max(from, to)
	if (hi <= lo) return null
	const blocks = collectAnchorBlocks(doc)
	const startIdx = blocks.findIndex((b) => b.kind === 'textblock' && lo >= b.pos + 1 && lo <= b.end - 1)
	const endIdx = blocks.findIndex((b) => b.kind === 'textblock' && hi >= b.pos + 1 && hi <= b.end - 1)
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null
	const startOffset = posToBlockOffset(blocks[startIdx]!, lo)
	const endOffset = posToBlockOffset(blocks[endIdx]!, hi)
	const selectedText = pmTextBetween(doc, lo, hi)
	if (selectedText.length === 0) return null
	return {
		v: 2,
		scope: 'range',
		selectedText,
		start: blockPointAt(blocks, startIdx, startOffset),
		end: blockPointAt(blocks, endIdx, endOffset),
	}
}

/**
 * Map a resolved whole-block placement back to the block node's ProseMirror
 * range (`[pos, pos + nodeSize)`) — the range a node decoration spans.
 */
export function wholeBlockPmRange(block: AnchorBlock): { from: number; to: number } {
	return { from: block.pos, to: block.end }
}
