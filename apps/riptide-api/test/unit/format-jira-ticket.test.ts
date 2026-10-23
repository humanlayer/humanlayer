import { describe, expect, test } from 'vitest'

import { formatJiraTicketMd } from '../../src/lib/format-jira-ticket'

describe('formatJiraTicketMd', () => {
	test('formats all issue fields', () => {
		expect(
			formatJiraTicketMd({
				key: 'OPS-7',
				summary: 'Fix task creation',
				status: 'In Progress',
				description: 'Use server data.',
				url: 'https://acme.atlassian.net/browse/OPS-7',
			}),
		).toBe(
			'[OPS-7] Fix task creation\nStatus: In Progress\n\nDescription:\nUse server data.\n\nView in Jira: https://acme.atlassian.net/browse/OPS-7',
		)
	})

	test('omits missing optional fields', () => {
		expect(
			formatJiraTicketMd({ key: 'OPS-8', summary: 'Short issue', url: 'https://jira.example/browse/OPS-8' }),
		).toBe('[OPS-8] Short issue\n\nView in Jira: https://jira.example/browse/OPS-8')
	})
})
