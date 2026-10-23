import { Editor, Node } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { buildOutline, collectDocumentHeadings } from '../toc/build-outline'
import { buildNavigableBlocks } from './build-navigable-blocks'

let editors: Editor[] = []
afterEach(() => {
	for (const e of editors) e.destroy()
	editors = []
})

// Schema stand-in for the production FrontmatterNode (same name/group/atom
// shape without its React node view), so the headless editor can carry one.
const FrontmatterStub = Node.create({
	name: 'frontmatter',
	group: 'block',
	atom: true,
	renderHTML() {
		return ['div', { 'data-type': 'frontmatter' }]
	},
})

function makeEditor(content: string | Record<string, unknown>): Editor {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, Image, FrontmatterStub],
		content: content as never,
		contentType: typeof content === 'string' ? 'markdown' : 'json',
		editable: false,
	})
	editors.push(editor)
	return editor
}

function blocksFor(editor: Editor) {
	const outline = buildOutline(collectDocumentHeadings(editor.state.doc))
	return buildNavigableBlocks(editor.state.doc, outline)
}

describe('buildNavigableBlocks', () => {
	test('returns an empty list for an empty document', () => {
		const editor = makeEditor('')
		// An empty doc still contains one empty paragraph textblock.
		const blocks = blocksFor(editor)
		expect(blocks.every((b) => b.kind === 'textblock')).toBe(true)
	})

	test('collects paragraphs, headings, and code blocks in document order', () => {
		const editor = makeEditor(
			['# Title', '', 'Intro paragraph.', '', '```ts', 'const x = 1', '```', '', 'Outro.'].join('\n'),
		)

		const blocks = blocksFor(editor)
		expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'codeBlock', 'paragraph'])
		// Document order: positions strictly ascend.
		for (let i = 1; i < blocks.length; i++) {
			expect(blocks[i]!.pos).toBeGreaterThan(blocks[i - 1]!.pos)
		}
		// Ranges cover the node.
		for (const block of blocks) {
			const node = editor.state.doc.nodeAt(block.pos)
			expect(node?.type.name).toBe(block.type)
			expect(block.end).toBe(block.pos + node!.nodeSize)
		}
	})

	test('list-item textblocks are targets; list containers are not', () => {
		const editor = makeEditor(['- item one', '- item two', '  - nested item', '', '1. ordered item'].join('\n'))

		const blocks = blocksFor(editor)
		const types = blocks.map((b) => b.type)
		expect(types).not.toContain('bulletList')
		expect(types).not.toContain('orderedList')
		expect(types).not.toContain('listItem')
		// One paragraph textblock per list item, in document order.
		const texts = blocks.map((b) => editor.state.doc.nodeAt(b.pos)!.textContent)
		expect(texts).toEqual(['item one', 'item two', 'nested item', 'ordered item'])
	})

	test('nested structures: blockquote paragraphs are targets, the blockquote is not', () => {
		const editor = makeEditor(['> quoted line', '', 'after quote'].join('\n'))

		const blocks = blocksFor(editor)
		expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
		expect(editor.state.doc.nodeAt(blocks[0]!.pos)!.textContent).toBe('quoted line')
	})

	test('horizontal rules are atom blocks', () => {
		const editor = makeEditor(['before', '', '---', '', 'after'].join('\n'))

		const blocks = blocksFor(editor)
		const hr = blocks.find((b) => b.type === 'horizontalRule')
		expect(hr).toBeDefined()
		expect(hr!.kind).toBe('atom')
		expect(blocks.map((b) => b.kind)).toEqual(['textblock', 'atom', 'textblock'])
	})

	test('block images are atom blocks', () => {
		const editor = makeEditor({
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
				{ type: 'image', attrs: { src: 'https://example.com/x.png', alt: 'x' } },
				{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
			],
		})

		const blocks = blocksFor(editor)
		expect(blocks.map((b) => [b.type, b.kind])).toEqual([
			['paragraph', 'textblock'],
			['image', 'atom'],
			['paragraph', 'textblock'],
		])
	})

	test('assigns each block its nearest preceding H1–H3 section; headings own themselves', () => {
		const editor = makeEditor(
			[
				'before any heading',
				'',
				'# Title',
				'',
				'intro',
				'',
				'## Section A',
				'',
				'- a1',
				'- a2',
				'',
				'### Deep',
				'',
				'deep para',
				'',
				'#### Not in outline',
				'',
				'after h4',
				'',
				'## Section B',
				'',
				'b para',
			].join('\n'),
		)

		const blocks = blocksFor(editor)
		const byText = new Map(blocks.map((b) => [editor.state.doc.nodeAt(b.pos)!.textContent, b]))

		expect(byText.get('before any heading')!.sectionId).toBeNull()
		expect(byText.get('Title')!.sectionId).toBe('h1-title')
		expect(byText.get('intro')!.sectionId).toBe('h1-title')
		expect(byText.get('Section A')!.sectionId).toBe('h2-section-a')
		expect(byText.get('a1')!.sectionId).toBe('h2-section-a')
		expect(byText.get('a2')!.sectionId).toBe('h2-section-a')
		expect(byText.get('Deep')!.sectionId).toBe('h3-deep')
		expect(byText.get('deep para')!.sectionId).toBe('h3-deep')
		// H4 headings are navigable textblocks but do not open a new outline section.
		expect(byText.get('Not in outline')!.sectionId).toBe('h3-deep')
		expect(byText.get('after h4')!.sectionId).toBe('h3-deep')
		expect(byText.get('Section B')!.sectionId).toBe('h2-section-b')
		expect(byText.get('b para')!.sectionId).toBe('h2-section-b')
	})

	test('frontmatter viewer chrome is not a navigable block', () => {
		const editor = makeEditor({
			type: 'doc',
			content: [
				{ type: 'frontmatter' },
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
			],
		})

		const blocks = blocksFor(editor)
		expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph'])
	})

	test('IDs are unique and stable for the same document', () => {
		const markdown = ['# A', '', 'p1', '', 'p1', '', '---', '', '# A'].join('\n')
		const first = blocksFor(makeEditor(markdown))
		const second = blocksFor(makeEditor(markdown))

		expect(new Set(first.map((b) => b.id)).size).toBe(first.length)
		expect(second.map((b) => b.id)).toEqual(first.map((b) => b.id))
	})
})
