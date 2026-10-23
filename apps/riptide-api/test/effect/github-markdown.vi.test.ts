import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { formatGitHubTicketMarkdown } from '../../src/effects/services/github/github.markdown'

describe('GitHub ticket markdown', () => {
	it.effect('formats authoritative issue text deterministically without creating image artifacts', () =>
		Effect.sync(() => {
			const markdown = formatGitHubTicketMarkdown(
				{
					repository: {
						id: '101',
						ownerLogin: 'acme',
						name: 'web',
						fullName: 'acme/web',
						private: true,
						defaultBranch: 'main',
						archived: false,
					},
					issueNumber: 482,
					title: 'Checkout failure\nwith retry',
					url: 'https://github.com/untrusted/preview/issues/1',
					state: 'open',
					body: 'The screenshot remains a source link.\n\n![failure](https://github.com/user-attachments/assets/abc)',
					labels: ['bug', ' checkout\nflow '],
					assignees: ['octocat'],
					authorLogin: 'mona',
					createdAt: '2026-07-17T00:00:00Z',
					updatedAt: '2026-07-17T01:00:00Z',
					comments: [
						{
							id: '90071992547409931236',
							url: 'https://github.com/acme/web/issues/482#issuecomment-1',
							body: 'Reproduced on staging.',
							authorLogin: null,
							createdAt: '2026-07-17T02:03:04Z',
							updatedAt: '2026-07-17T02:03:04Z',
						},
					],
				},
				'https://github.com/acme/web/issues/482',
			)

			expect(markdown).toMatchInlineSnapshot(`
"[#482] Checkout failure with retry
State: open
Labels: bug, checkout flow
Assignees: octocat

Description:
The screenshot remains a source link.

![failure](https://github.com/user-attachments/assets/abc)

Comments:
[2026-07-17T02:03:04Z] unknown GitHub user:
Reproduced on staging.

View on GitHub: https://github.com/acme/web/issues/482
"
`)
			expect(markdown).not.toContain('```task-artifact')
		}),
	)

	it.effect('renders explicit empty metadata and sections', () =>
		Effect.sync(() => {
			const markdown = formatGitHubTicketMarkdown(
				{
					repository: {
						id: '102',
						ownerLogin: 'acme',
						name: 'api',
						fullName: 'acme/api',
						private: false,
						defaultBranch: 'main',
						archived: false,
					},
					issueNumber: 1,
					title: 'Empty issue',
					url: 'https://github.com/acme/api/issues/1',
					state: 'closed',
					body: '',
					labels: [],
					assignees: [],
					authorLogin: null,
					createdAt: '2026-07-17T00:00:00Z',
					updatedAt: '2026-07-17T00:00:00Z',
					comments: [],
				},
				'https://github.com/acme/api/issues/1',
			)

			expect(markdown).toContain('Labels: None')
			expect(markdown).toContain('Assignees: None')
			expect(markdown).toContain('Description:\n(no description)')
			expect(markdown).toContain('Comments:\nNone')
		}),
	)

	it.effect('references only successful sibling image artifacts and preserves failed source URLs', () =>
		Effect.sync(() => {
			const issue = {
				repository: {
					id: '101',
					ownerLogin: 'acme',
					name: 'web',
					fullName: 'acme/web',
					private: true,
					defaultBranch: 'main',
					archived: false,
				},
				issueNumber: 482,
				title: 'Image issue',
				url: 'https://github.com/acme/web/issues/482',
				state: 'open' as const,
				body: '![ok](https://github.com/user-attachments/assets/ok)\n![bad](https://github.com/user-attachments/assets/bad)',
				labels: [],
				assignees: [],
				authorLogin: 'mona',
				createdAt: '2026-07-17T00:00:00Z',
				updatedAt: '2026-07-17T00:00:00Z',
				comments: [],
			}
			const markdown = formatGitHubTicketMarkdown(issue, issue.url, [
				{
					sourceUrl: 'https://github.com/user-attachments/assets/ok',
					altText: 'ok',
					artifact: {
						fileName: 'img-482-ok.png',
						contentType: 'image/png',
						fileSizeBytes: 3,
						contentHash: 'hash',
						s3Key: 'organizations/org/tasks/task/img-482-ok.png',
					},
					failureReason: null,
				},
				{
					sourceUrl: 'https://github.com/user-attachments/assets/bad',
					altText: 'bad',
					artifact: null,
					failureReason: 'download_failed',
				},
			])

			expect(markdown).toContain('```task-artifact\nimg-482-ok.png\n```')
			expect(markdown).not.toContain('```task-artifact\norganizations/')
			expect(markdown).toContain(
				'[Image could not be imported: bad](https://github.com/user-attachments/assets/bad)',
			)
		}),
	)
})
