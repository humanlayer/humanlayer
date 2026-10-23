import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { flattenOutline, type OutlineItem } from '../toc/build-outline'

export type NavigableBlockKind = 'textblock' | 'atom'

/**
 * Block nodes that render viewer chrome rather than document content. They are
 * never keyboard-navigation or comment targets, mirroring the V1 search
 * extension's frontmatter skip.
 */
const EXCLUDED_BLOCK_TYPES = new Set(['frontmatter'])

/**
 * One commentable document block in the canonical keyboard-navigation order.
 * This is the shared target model for keyboard block focus now and for
 * keyboard comment actions in later slices.
 */
export interface NavigableBlock {
	/** Stable render identity for the current (content-keyed) document. */
	id: string
	/** Absolute ProseMirror position of the block node. */
	pos: number
	/** End of the block's range: `pos + nodeSize`. */
	end: number
	/** ProseMirror node type name (`paragraph`, `heading`, `codeBlock`, …). */
	type: string
	/** Textblocks host text content; atoms are leaf blocks like images/HRs. */
	kind: NavigableBlockKind
	/**
	 * Outline ID of the nearest H1–H3 section containing this block (a heading
	 * block is its own section). Null for blocks before the first outline
	 * heading.
	 */
	sectionId: string | null
}

/**
 * Build the canonical, document-ordered list of commentable blocks from the
 * live ProseMirror document: every textblock (paragraphs, headings, code
 * blocks, list-item textblocks, table-cell paragraphs, …) plus block-level
 * atoms (images, horizontal rules). Container nodes (lists, blockquotes,
 * tables) are traversed, not targeted.
 *
 * `outline` is the H1–H3 outline built by `buildOutline` for the same
 * document; it supplies the nearest-section assignment.
 */
export function buildNavigableBlocks(doc: ProseMirrorNode, outline: OutlineItem[]): NavigableBlock[] {
	// flattenOutline preserves document order, so `pos` ascends.
	const orderedOutline = flattenOutline(outline)
	const blocks: NavigableBlock[] = []
	// Index of the last outline heading at or before the block being visited.
	let sectionIndex = -1

	doc.descendants((node, pos) => {
		if (EXCLUDED_BLOCK_TYPES.has(node.type.name)) return false
		const isBlockAtom = node.isBlock && node.isAtom && !node.isTextblock
		if (!node.isTextblock && !isBlockAtom) return true

		while (sectionIndex + 1 < orderedOutline.length && orderedOutline[sectionIndex + 1]!.pos <= pos) {
			sectionIndex++
		}

		blocks.push({
			id: `${node.type.name}-${pos}`,
			pos,
			end: pos + node.nodeSize,
			type: node.type.name,
			kind: node.isTextblock ? 'textblock' : 'atom',
			sectionId: sectionIndex >= 0 ? orderedOutline[sectionIndex]!.id : null,
		})

		// Blocks are leaves of the navigation model: never descend into them.
		return false
	})

	return blocks
}
