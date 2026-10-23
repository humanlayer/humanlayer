import { describe, expect, test } from 'vitest'

import { formatLinearTicketMd, type LinearIssue } from './format-linear-ticket'
import { buildImageReplacementMap, gatherIssueContent } from './linear-ticket-artifacts'

describe('gatherIssueContent', () => {
	test('gathers description only', () => {
		const issue: LinearIssue = {
			identifier: 'ENG-123',
			title: 'Test',
			url: 'https://linear.app/test',
			branch: null,
			status: 'Todo',
			assignee: null,
			description: 'This is the description',
			comments: [],
			parents: [],
		}
		expect(gatherIssueContent(issue)).toBe('This is the description')
	})

	test('gathers description and comments', () => {
		const issue: LinearIssue = {
			identifier: 'ENG-123',
			title: 'Test',
			url: 'https://linear.app/test',
			branch: null,
			status: 'Todo',
			assignee: null,
			description: 'Description',
			comments: [
				{ author: 'Alice', body: 'Comment 1', createdAt: '2024-01-01' },
				{ author: 'Bob', body: 'Comment 2', createdAt: '2024-01-02' },
			],
			parents: [],
		}
		expect(gatherIssueContent(issue)).toBe('Description\nComment 1\nComment 2')
	})

	test('gathers parent issue content', () => {
		const issue: LinearIssue = {
			identifier: 'ENG-123',
			title: 'Test',
			url: 'https://linear.app/test',
			branch: null,
			status: 'Todo',
			assignee: null,
			description: 'Child description',
			comments: [],
			parents: [
				{
					identifier: 'ENG-100',
					title: 'Parent',
					status: 'Done',
					assignee: null,
					description: 'Parent description',
					comments: [{ author: 'Alice', body: 'Parent comment', createdAt: '2024-01-01' }],
				},
			],
		}
		expect(gatherIssueContent(issue)).toBe('Child description\nParent description\nParent comment')
	})

	test('handles null description', () => {
		const issue: LinearIssue = {
			identifier: 'ENG-123',
			title: 'Test',
			url: 'https://linear.app/test',
			branch: null,
			status: 'Todo',
			assignee: null,
			description: null,
			comments: [{ author: 'Alice', body: 'Comment', createdAt: '2024-01-01' }],
			parents: [],
		}
		expect(gatherIssueContent(issue)).toBe('\nComment')
	})
})

describe('buildImageReplacementMap', () => {
	test('builds map from image URLs', () => {
		const content = '![screenshot](https://uploads.linear.app/abc123/image.png)'
		const result = buildImageReplacementMap(content, 'ENG-123')

		expect(result.size).toBe(1)
		expect(result.get('https://uploads.linear.app/abc123/image.png')).toBe('img-ENG-123-image.png')
	})

	test('handles multiple images', () => {
		const content = `
			![one](https://uploads.linear.app/1.png)
			![two](https://uploads.linear.app/2.jpg)
		`
		const result = buildImageReplacementMap(content, 'ENG-456')

		expect(result.size).toBe(2)
		expect(result.get('https://uploads.linear.app/1.png')).toBe('img-ENG-456-1.png')
		expect(result.get('https://uploads.linear.app/2.jpg')).toBe('img-ENG-456-2.jpg')
	})

	test('deduplicates same URL', () => {
		const content = `
			![first](https://uploads.linear.app/same.png)
			![second](https://uploads.linear.app/same.png)
		`
		const result = buildImageReplacementMap(content, 'ENG-789')

		expect(result.size).toBe(1)
	})

	test('returns empty map for content without images', () => {
		const result = buildImageReplacementMap('Just text, no images', 'ENG-123')
		expect(result.size).toBe(0)
	})
})

describe('formatLinearTicketMd image outcomes', () => {
	test('references only successful image artifacts and keeps failed source URLs clickable', () => {
		const successfulUrl = 'https://uploads.linear.app/success.png'
		const failedUrl = 'https://uploads.linear.app/failure.png'
		const issue: LinearIssue = {
			identifier: 'ENG-123',
			title: 'Image ordering',
			url: 'https://linear.app/acme/issue/ENG-123',
			branch: null,
			status: 'Todo',
			assignee: null,
			description: `![success](${successfulUrl})\n![failure](${failedUrl})`,
			comments: [],
			parents: [],
		}
		const markdown = formatLinearTicketMd(
			issue,
			new Map([[successfulUrl, 'img-ENG-123-success.png']]),
			new Set([failedUrl]),
		)

		expect(markdown).toContain('```task-artifact\nimg-ENG-123-success.png\n```')
		expect(markdown).toContain(`[Image could not be imported: failure](${failedUrl})`)
		expect(markdown).not.toContain('```task-artifact\nimg-ENG-123-failure.png')
	})
})
