import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import {
	buildHeadingAnchors,
	buildOutline,
	collectDocumentHeadings,
	flattenOutline,
	type DocumentHeading,
} from './build-outline'

function heading(level: number, text: string, pos: number): DocumentHeading {
	return { level, text, pos }
}

describe('buildOutline', () => {
	test('returns an empty outline for an empty document', () => {
		expect(buildOutline([])).toEqual([])
	})

	test('nests H1 → H2 → H3 hierarchically', () => {
		const outline = buildOutline([
			heading(1, 'Title', 0),
			heading(2, 'Section', 10),
			heading(3, 'Detail', 20),
		])

		expect(outline).toHaveLength(1)
		expect(outline[0]!.text).toBe('Title')
		expect(outline[0]!.children).toHaveLength(1)
		expect(outline[0]!.children[0]!.text).toBe('Section')
		expect(outline[0]!.children[0]!.children).toHaveLength(1)
		expect(outline[0]!.children[0]!.children[0]!.text).toBe('Detail')
	})

	test('pops peers: a sibling H2 attaches to the H1, not the previous H2', () => {
		const outline = buildOutline([
			heading(1, 'Title', 0),
			heading(2, 'First', 10),
			heading(2, 'Second', 20),
		])

		expect(outline[0]!.children.map((c) => c.text)).toEqual(['First', 'Second'])
		expect(outline[0]!.children[0]!.children).toEqual([])
	})

	test('pops ancestors: an H1 after a deep H3 starts a new root', () => {
		const outline = buildOutline([
			heading(1, 'Alpha', 0),
			heading(2, 'Alpha Sub', 10),
			heading(3, 'Alpha Deep', 20),
			heading(1, 'Beta', 30),
			heading(2, 'Beta Sub', 40),
		])

		expect(outline.map((item) => item.text)).toEqual(['Alpha', 'Beta'])
		expect(outline[1]!.children.map((c) => c.text)).toEqual(['Beta Sub'])
	})

	test('an H3 directly under an H1 (skipping H2) nests under the H1', () => {
		const outline = buildOutline([heading(1, 'Title', 0), heading(3, 'Deep', 10)])

		expect(outline).toHaveLength(1)
		expect(outline[0]!.children.map((c) => c.text)).toEqual(['Deep'])
	})

	test('a subheading before any parent becomes a root', () => {
		const outline = buildOutline([heading(2, 'Orphan', 0), heading(1, 'Title', 10)])

		expect(outline.map((item) => `${item.level}:${item.text}`)).toEqual(['2:Orphan', '1:Title'])
	})

	test('preserves document order when flattened', () => {
		const outline = buildOutline([
			heading(1, 'A', 0),
			heading(2, 'B', 10),
			heading(3, 'C', 20),
			heading(2, 'D', 30),
			heading(1, 'E', 40),
		])

		expect(flattenOutline(outline).map((item) => item.text)).toEqual(['A', 'B', 'C', 'D', 'E'])
	})

	test('excludes H4 and deeper headings', () => {
		const outline = buildOutline([
			heading(1, 'Title', 0),
			heading(4, 'Too Deep', 10),
			heading(5, 'Deeper', 20),
			heading(6, 'Deepest', 30),
			heading(2, 'Section', 40),
		])

		expect(flattenOutline(outline).map((item) => item.text)).toEqual(['Title', 'Section'])
	})

	test('duplicate visible heading text produces distinct deterministic IDs', () => {
		const outline = buildOutline([
			heading(1, 'Setup', 0),
			heading(2, 'Example', 10),
			heading(1, 'Teardown', 20),
			heading(2, 'Example', 30),
			heading(2, 'Example', 40),
		])

		const flat = flattenOutline(outline)
		const exampleIds = flat.filter((item) => item.text === 'Example').map((item) => item.id)
		expect(exampleIds).toEqual(['h2-example', 'h2-example-2', 'h2-example-3'])
		expect(new Set(flat.map((item) => item.id)).size).toBe(flat.length)
	})

	test('same text at different levels does not collide', () => {
		const outline = buildOutline([heading(1, 'Notes', 0), heading(2, 'Notes', 10)])

		const flat = flattenOutline(outline)
		expect(flat.map((item) => item.id)).toEqual(['h1-notes', 'h2-notes'])
	})

	test('empty heading text still gets a usable ID', () => {
		const outline = buildOutline([heading(1, '', 0), heading(1, '', 10)])

		expect(outline.map((item) => item.id)).toEqual(['h1-untitled', 'h1-untitled-2'])
	})
})

describe('buildHeadingAnchors', () => {
	test('creates deep-link IDs for every heading level', () => {
		expect(
			buildHeadingAnchors([
				heading(1, 'Title', 0),
				heading(4, 'Detail', 10),
				heading(6, 'Detail', 20),
				heading(4, 'Detail', 30),
			]).map(({ id, pos }) => [id, pos]),
		).toEqual([
			['h1-title', 0],
			['h4-detail', 10],
			['h6-detail', 20],
			['h4-detail-2', 30],
		])
	})
})

describe('collectDocumentHeadings', () => {
	let editors: Editor[] = []
	afterEach(() => {
		for (const e of editors) e.destroy()
		editors = []
	})

	function makeEditor(markdown: string): Editor {
		const editor = new Editor({
			extensions: [StarterKit, Markdown],
			content: markdown,
			contentType: 'markdown',
			editable: false,
		})
		editors.push(editor)
		return editor
	}

	test('collects heading levels, rendered text, and resolvable positions from the live document', () => {
		const editor = makeEditor(
			['# Title', '', 'Intro paragraph.', '', '## Section *one*', '', 'Body.', '', '#### Too deep', ''].join(
				'\n',
			),
		)

		const headings = collectDocumentHeadings(editor.state.doc)

		expect(headings.map((h) => [h.level, h.text])).toEqual([
			[1, 'Title'],
			[2, 'Section one'],
			[4, 'Too deep'],
		])
		for (const h of headings) {
			const node = editor.state.doc.nodeAt(h.pos)
			expect(node?.type.name).toBe('heading')
			expect(node?.textContent).toBe(h.text)
		}
	})

	test('feeds buildOutline: H4+ excluded, duplicates remain separately navigable', () => {
		const editor = makeEditor(
			['# Doc', '', '## Example', '', 'a', '', '## Example', '', '#### Skipped', ''].join('\n'),
		)

		const outline = buildOutline(collectDocumentHeadings(editor.state.doc))
		const flat = flattenOutline(outline)

		expect(flat.map((item) => item.text)).toEqual(['Doc', 'Example', 'Example'])
		expect(flat[1]!.id).not.toBe(flat[2]!.id)
		expect(flat[1]!.pos).not.toBe(flat[2]!.pos)
	})
})
