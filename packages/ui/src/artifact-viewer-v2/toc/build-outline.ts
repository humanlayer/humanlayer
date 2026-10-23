import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** Outline navigation covers document headings H1–H3 only. */
export type OutlineLevel = 1 | 2 | 3

/**
 * A heading observed in the live TipTap document, in document order.
 * `pos` is the ProseMirror position of the heading node's opening token,
 * which stays valid for the lifetime of a read-only, content-keyed editor.
 */
export interface DocumentHeading {
	/** Heading level as authored (1–6); levels above 3 are excluded from the outline. */
	level: number
	/** Rendered heading text (no markdown syntax). */
	text: string
	/** Absolute ProseMirror position of the heading node. */
	pos: number
}

/** A stable deep-link target for any authored heading level. */
export interface HeadingAnchor extends DocumentHeading {
	id: string
}

/** One navigable outline entry. Children are the nested lower-level headings. */
export interface OutlineItem {
	/** Deterministic, duplicate-safe ID derived from level + text + occurrence. */
	id: string
	level: OutlineLevel
	text: string
	/** Absolute ProseMirror position of the heading node for navigation. */
	pos: number
	children: OutlineItem[]
}

const OUTLINE_MAX_LEVEL = 3

/**
 * Collect every heading node from a live ProseMirror document in document
 * order. Level filtering is left to {@link buildOutline} so callers can reuse
 * the raw observation list.
 */
export function collectDocumentHeadings(doc: ProseMirrorNode): DocumentHeading[] {
	const headings: DocumentHeading[] = []
	doc.descendants((node, pos) => {
		if (node.type.name !== 'heading') return
		headings.push({ level: Number(node.attrs.level), text: node.textContent, pos })
	})
	return headings
}

function slugifyHeadingText(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return slug.length > 0 ? slug : 'untitled'
}

/** Build deterministic, duplicate-safe IDs for every H1-H6 heading. */
export function buildHeadingAnchors(headings: DocumentHeading[]): HeadingAnchor[] {
	const idOccurrences = new Map<string, number>()
	const anchors: HeadingAnchor[] = []

	for (const heading of headings) {
		if (heading.level < 1 || heading.level > 6) continue
		const idBase = `h${heading.level}-${slugifyHeadingText(heading.text)}`
		const occurrence = (idOccurrences.get(idBase) ?? 0) + 1
		idOccurrences.set(idBase, occurrence)
		anchors.push({
			...heading,
			id: occurrence === 1 ? idBase : `${idBase}-${occurrence}`,
		})
	}

	return anchors
}

/**
 * Build the nested H1–H3 outline from document-order headings using a stack:
 * a new heading pops every open entry of equal-or-higher level, then attaches
 * to the remaining top (or becomes a root). Headings deeper than H3 are
 * excluded; a subheading that appears before any parent becomes a root.
 *
 * IDs are deterministic and duplicate-safe: identical visible heading text
 * yields `h2-title`, `h2-title-2`, `h2-title-3`, … in document order.
 */
export function buildOutline(headings: DocumentHeading[]): OutlineItem[] {
	const roots: OutlineItem[] = []
	const stack: OutlineItem[] = []

	for (const heading of buildHeadingAnchors(headings)) {
		if (heading.level < 1 || heading.level > OUTLINE_MAX_LEVEL) continue
		const level = heading.level as OutlineLevel
		const item: OutlineItem = { id: heading.id, level, text: heading.text, pos: heading.pos, children: [] }

		while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
			stack.pop()
		}
		const parent = stack[stack.length - 1]
		if (parent) {
			parent.children.push(item)
		} else {
			roots.push(item)
		}
		stack.push(item)
	}

	return roots
}

/** Flatten an outline back to document order (parents before their children). */
export function flattenOutline(items: OutlineItem[]): OutlineItem[] {
	const flat: OutlineItem[] = []
	const visit = (item: OutlineItem) => {
		flat.push(item)
		for (const child of item.children) visit(child)
	}
	for (const item of items) visit(item)
	return flat
}
