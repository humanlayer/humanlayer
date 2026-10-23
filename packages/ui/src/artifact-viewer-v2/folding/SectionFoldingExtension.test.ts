import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, test } from 'vitest'

import { buildOutline, collectDocumentHeadings } from '../toc/build-outline'
import { buildNavigableBlocks } from '../viewer/build-navigable-blocks'
import { SectionFoldingExtension, getFoldedHeadingIds, setSectionFolding } from './SectionFoldingExtension'
import { buildSectionRanges } from './section-ranges'

let editors: Editor[] = []
afterEach(() => {
	for (const editor of editors) editor.destroy()
	editors = []
})

function makeEditor() {
	const editor = new Editor({
		extensions: [StarterKit, Markdown, SectionFoldingExtension],
		content: '# Parent\n\nBody\n\n## Child\n\nNested\n\n# Sibling\n\nVisible',
		contentType: 'markdown',
		editable: false,
	})
	editors.push(editor)
	const outline = buildOutline(collectDocumentHeadings(editor.state.doc))
	return { editor, outline, ranges: buildSectionRanges(outline, buildNavigableBlocks(editor.state.doc, outline)) }
}

describe('SectionFoldingExtension', () => {
	test('hides a folded section including nested subsections but not its sibling', () => {
		const { editor, outline, ranges } = makeEditor()
		setSectionFolding(editor.view, ranges, new Set([outline[0]!.id]))
		expect(editor.view.dom.querySelectorAll('.artifact-viewer-v2-section-hidden')).toHaveLength(3)
		expect(editor.view.dom.textContent).toContain('Sibling')
	})

	test('expansion restores descendants and state', () => {
		const { editor, outline, ranges } = makeEditor()
		setSectionFolding(editor.view, ranges, new Set([outline[0]!.id]))
		setSectionFolding(editor.view, ranges, new Set())
		expect(getFoldedHeadingIds(editor.state).size).toBe(0)
		expect(editor.view.dom.querySelectorAll('.artifact-viewer-v2-section-hidden')).toHaveLength(0)
	})

	test('a remounted document starts expanded', () => {
		const first = makeEditor()
		setSectionFolding(first.editor.view, first.ranges, new Set([first.outline[0]!.id]))
		const second = makeEditor()
		expect(getFoldedHeadingIds(second.editor.state).size).toBe(0)
	})

	test('swapping in a shorter document keeps folds by heading id without reading stale positions', () => {
		const { editor, outline, ranges } = makeEditor()
		const sibling = outline[1]!
		setSectionFolding(editor.view, ranges, new Set([sibling.id]))

		editor.commands.setContent('# Sibling\n\nVisible', { contentType: 'markdown' })

		expect(getFoldedHeadingIds(editor.state)).toEqual(new Set([sibling.id]))
		expect(editor.view.dom.querySelectorAll('.artifact-viewer-v2-heading-disclosure')).toHaveLength(1)
		expect(editor.view.dom.querySelectorAll('.artifact-viewer-v2-section-hidden')).toHaveLength(1)
	})

	test('renders the disclosure as a chevron icon, not a text glyph', () => {
		const { editor } = makeEditor()
		const button = editor.view.dom.querySelector<HTMLButtonElement>('.artifact-viewer-v2-heading-disclosure')
		expect(button).not.toBeNull()
		// The real lucide ChevronRight icon, reused from the sidebar task tree —
		// an SVG, never a `›`/`▸` character.
		expect(button?.querySelector('svg.lucide-chevron-right')).not.toBeNull()
		expect(button?.textContent).toBe('')
	})

	test('keeps the disclosure out of a heading’s leading inline-code mark', () => {
		const editor = new Editor({
			extensions: [StarterKit, Markdown, SectionFoldingExtension],
			content: '# `config.ts` overview\n\nBody',
			contentType: 'markdown',
			editable: false,
		})
		editors.push(editor)
		const button = editor.view.dom.querySelector<HTMLButtonElement>('.artifact-viewer-v2-heading-disclosure')
		expect(button).not.toBeNull()
		// The control must not live inside the authored `<code>` span, so it can
		// never inherit that inline-code box/background.
		expect(button?.closest('code')).toBeNull()
		// It still sits inside the heading, beside the text.
		expect(button?.closest('h1')).not.toBeNull()
	})

	test('hides list containers instead of leaving visible marker shells', () => {
		const editor = new Editor({
			extensions: [StarterKit, Markdown, SectionFoldingExtension],
			content: '## Packages\n\n### Daemon\n\n- One\n- Two\n\n### UI\n\nVisible',
			contentType: 'markdown',
			editable: false,
		})
		editors.push(editor)
		const outline = buildOutline(collectDocumentHeadings(editor.state.doc))
		const ranges = buildSectionRanges(outline, buildNavigableBlocks(editor.state.doc, outline))
		const daemon = outline[0]!.children[0]!

		setSectionFolding(editor.view, ranges, new Set([daemon.id]))

		const hidden = editor.view.dom.querySelectorAll('.artifact-viewer-v2-section-hidden')
		expect(hidden).toHaveLength(1)
		expect(hidden[0]?.tagName).toBe('UL')
		expect(editor.view.dom.querySelectorAll('li.artifact-viewer-v2-section-hidden')).toHaveLength(0)
	})
})
