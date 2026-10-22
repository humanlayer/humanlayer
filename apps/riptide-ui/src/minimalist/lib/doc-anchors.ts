import {
	type AnchorBlock,
	type AnchorV2,
	createWholeBlockAnchor,
	resolveAnchor,
} from '@humanlayer/ui/artifact-viewer-v2'
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

/**
 * Comments anchor to the same blocks the standard artifact viewer does, so a comment left in either
 * interface lands on the same text in the other. Its blocks are ProseMirror textblocks: each
 * paragraph, heading, code block, list item and table cell, plus rules as empty atoms. This reads
 * them from the markdown so a thread's place is known before the document renders.
 */
export type DocBlock = AnchorBlock & {
	/** The top-level block (from `splitBlocks`) this one renders inside. */
	top: number
	/** Its position among the textblocks and atoms of that top-level block. */
	ordinal: number
}

/** A point in the rendered document: a block, and a character offset into its text. */
export type DocPoint = { top: number; ordinal: number; offset: number }

type Piece = { type: string; text: string; atom: boolean }

/** The anchorable blocks of a document split by `splitBlocks`, in reading order. */
export function docBlocks(blocks: readonly string[]): DocBlock[] {
	const out: DocBlock[] = []
	let pos = 0
	blocks.forEach((markdown, top) => {
		pieces(parse(markdown)).forEach((piece, ordinal) => {
			// Synthetic positions: each block owns [pos, end), its text starting at pos + 1.
			const end = pos + piece.text.length + 2
			out.push({
				id: `${top}:${ordinal}`,
				pos,
				end,
				type: piece.type,
				kind: piece.atom ? 'atom' : 'textblock',
				text: piece.text,
				segments: piece.atom ? [] : [{ charStart: 0, pmStart: pos + 1, length: piece.text.length }],
				top,
				ordinal,
			})
			pos = end
		})
	})
	return out
}

/** The text an anchor covers now, from one block point to another, or null once it is gone. */
export function anchorSpan(blocks: readonly DocBlock[], anchor: AnchorV2): { start: DocPoint; end: DocPoint } | null {
	const placement = resolveAnchor(blocks as DocBlock[], anchor)
	if (placement.status !== 'resolved') return null
	// Blocks are contiguous: a start sits at or after a block's position, an exclusive end at or before its end.
	const first = blocks.find((block) => placement.from >= block.pos && placement.from < block.end)
	const last = blocks.find((block) => placement.to > block.pos && placement.to <= block.end)
	if (!first || !last) return null
	const offset = (block: DocBlock, pos: number) => Math.max(0, Math.min(pos - block.pos - 1, block.text.length))
	return {
		start: { top: first.top, ordinal: first.ordinal, offset: offset(first, placement.from) },
		end: { top: last.top, ordinal: last.ordinal, offset: offset(last, placement.to) },
	}
}

/**
 * An anchor on a whole top-level block. One textblock is a block anchor, as the standard viewer
 * writes; a list or table spans its first to last textblock as a range.
 */
export function topBlockAnchor(blocks: readonly DocBlock[], top: number): AnchorV2 | null {
	const inside = blocks.filter((block) => block.top === top && block.kind === 'textblock')
	const first = inside[0]
	const last = inside.at(-1)
	if (!first || !last) return null
	const firstIndex = blocks.indexOf(first)
	if (first === last) return createWholeBlockAnchor(blocks as DocBlock[], firstIndex)
	return rangeAnchor(
		blocks,
		{ top, ordinal: first.ordinal, offset: 0 },
		{ top, ordinal: last.ordinal, offset: last.text.length },
	)
}

/**
 * An anchor on text you selected, from one block and offset to another. The quote is rebuilt
 * from the block text with a newline between blocks, which is how the standard viewer compares it.
 */
export function rangeAnchor(blocks: readonly DocBlock[], start: DocPoint, end: DocPoint): AnchorV2 | null {
	const find = (point: DocPoint) =>
		blocks.findIndex((block) => block.top === point.top && block.ordinal === point.ordinal)
	const from = find(start)
	const to = find(end)
	const first = blocks[from]
	const last = blocks[to]
	if (!first || !last || to < from || first.kind !== 'textblock' || last.kind !== 'textblock') return null
	const quote =
		from === to
			? first.text.slice(start.offset, end.offset)
			: [
					first.text.slice(start.offset),
					...blocks.slice(from + 1, to).map((block) => block.text),
					last.text.slice(0, end.offset),
				].join('\n')
	if (!quote.trim()) return null
	const point = (index: number, offset: number) => ({
		blockType: blocks[index]?.type ?? 'paragraph',
		blockText: blocks[index]?.text ?? '',
		previousBlockText: blocks[index - 1]?.text ?? null,
		nextBlockText: blocks[index + 1]?.text ?? null,
		offset,
	})
	return { v: 2, scope: 'range', selectedText: quote, start: point(from, start.offset), end: point(to, end.offset) }
}

function parse(markdown: string) {
	return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

/** Textblocks and atoms in document order, named as ProseMirror names them. */
function pieces(node: Nodes): Piece[] {
	switch (node.type) {
		case 'paragraph': {
			// A paragraph of only images renders as image blocks.
			const images = node.children.filter((child) => child.type === 'image')
			const alone =
				images.length > 0 &&
				node.children.every((child) => child.type === 'image' || (child.type === 'text' && !child.value.trim()))
			return alone
				? images.map(() => ({ type: 'image', text: '', atom: true }))
				: [{ type: 'paragraph', text: inline(node), atom: false }]
		}
		case 'tableCell':
			return [{ type: 'paragraph', text: inline(node), atom: false }]
		case 'heading':
			return [{ type: 'heading', text: inline(node), atom: false }]
		case 'code':
			return [{ type: 'codeBlock', text: node.value, atom: false }]
		case 'thematicBreak':
			return [{ type: 'horizontalRule', text: '', atom: true }]
		case 'html':
		case 'definition':
		case 'yaml':
			return []
		default:
			return 'children' in node ? node.children.flatMap((child) => pieces(child as Nodes)) : []
	}
}

/** A textblock's text as ProseMirror's `textContent` reads it: images add nothing, a hard break is a newline. */
function inline(node: Nodes): string {
	switch (node.type) {
		case 'text':
		case 'inlineCode':
			return node.value
		case 'break':
			return '\n'
		case 'image':
		case 'imageReference':
		case 'html':
		case 'footnoteReference':
			return ''
		default:
			return 'children' in node ? node.children.map((child) => inline(child as Nodes)).join('') : ''
	}
}
