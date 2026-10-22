import { describe, expect, it } from 'vitest'

import {
	artifactPath,
	taskArtifactPaths,
	body,
	docKind,
	headingsOf,
	isAttachment,
	isHtmlArtifact,
	isImageArtifact,
	isListedArtifact,
	wordCount,
} from '@/minimalist/lib/artifacts'

describe('body', () => {
	it('drops frontmatter and HTML comments', () => {
		const markdown = [
			'---',
			'title: Plan',
			'---',
			'# Plan',
			'',
			'Text',
			'',
			'<!--',
			'HumanLayer-Session: https://example.com/sessions/1',
			'-->',
		].join('\n')
		expect(body(markdown)).toBe('# Plan\n\nText')
	})

	it('keeps comments inside fenced code', () => {
		const markdown = ['```html', '<!-- keep -->', '```', '', '<!-- drop -->', 'After'].join('\n')
		expect(body(markdown)).toBe('```html\n<!-- keep -->\n```\n\nAfter')
	})
})

describe('artifactPath', () => {
	it('reads the slug and file name from a task file', () => {
		expect(artifactPath('/Users/me/repo/.humanlayer/tasks/fix-thing-1a2b/01-research-x.md')).toEqual({
			slug: 'fix-thing-1a2b',
			fileName: '01-research-x.md',
		})
		expect(artifactPath('/w/.humanlayer/tasks/s/mockups/a.md')?.fileName).toBe('mockups/a.md')
	})

	it('ignores files outside task folders', () => {
		expect(artifactPath('/Users/me/repo/src/index.ts')).toBeNull()
		expect(artifactPath('/Users/me/repo/.humanlayer/tasks/only-slug')).toBeNull()
	})
})

describe('docKind', () => {
	it('names the document from its file name', () => {
		expect(docKind('01-research-electric-pagination.md')).toBe('Research')
		expect(docKind('03-plan-billing.md')).toBe('Plan')
		expect(docKind('pr-description.md')).toBe('PR description')
		expect(docKind('poem.md')).toBe('Document')
		expect(docKind('explanation.md')).toBe('Document')
	})
})

describe('wordCount', () => {
	it('counts words a reader sees', () => {
		expect(wordCount('---\ntitle: x\n---\n# Two words\n\nThree more **here**\n<!-- hidden trailer -->')).toBe(5)
	})
})

describe('headingsOf', () => {
	it('lists H1 to H3 blocks with their depth, as plain text', () => {
		expect(
			headingsOf([
				'# Plan',
				'Intro',
				'## Step **one**\nDetails right below',
				'#### Too deep',
				'```\n# not a heading\n```',
			]),
		).toEqual([
			{ index: 0, depth: 1, text: 'Plan' },
			{ index: 2, depth: 2, text: 'Step one' },
		])
	})
})

describe('isAttachment', () => {
	it('knows uploads and images from documents the agent wrote', () => {
		expect(isAttachment({ file_name: 'uploads/01a0e64c-38c5-7bbd-9112-15b5e0f40b1f-notes.txt' })).toBe(true)
		expect(isAttachment({ file_name: 'diagram.png' })).toBe(true)
		expect(isAttachment({ file_name: '02-plan.md' })).toBe(false)
		expect(isAttachment({ file_name: 'notes/uploads.md' })).toBe(false)
	})
})

describe('isListedArtifact', () => {
	it('lists documents and images the agent saved, but not uploads or archives', () => {
		const listed = (file_name: string) => isListedArtifact({ file_name })
		expect(listed('02-research.md')).toBe(true)
		expect(listed('screens/board.png')).toBe(true)
		expect(listed('model-menu.JPG')).toBe(true)
		expect(listed('uploads/01a1-shot.png')).toBe(false)
		expect(listed('uploads/notes.md')).toBe(false)
		expect(listed('bundle.zip')).toBe(false)
		expect(listed('report.pdf')).toBe(false)
		expect(isImageArtifact({ file_name: 'board.png' })).toBe(true)
		expect(isImageArtifact({ file_name: 'uploads/board.png' })).toBe(false)
	})
})

describe('isHtmlArtifact', () => {
	it('picks out web pages by extension', () => {
		expect(isHtmlArtifact({ file_name: 'demo.html' })).toBe(true)
		expect(isHtmlArtifact({ file_name: 'mockups/board.HTM' })).toBe(true)
		expect(isHtmlArtifact({ file_name: '02-research.md' })).toBe(false)
	})
})

describe('taskArtifactPaths', () => {
	it('reads one path per line and skips blank lines', () => {
		expect(taskArtifactPaths('\n /tmp/a/shot.png \n\n/tmp/a/report.html\n')).toEqual([
			'/tmp/a/shot.png',
			'/tmp/a/report.html',
		])
	})
})
