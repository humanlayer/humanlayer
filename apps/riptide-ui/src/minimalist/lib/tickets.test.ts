import { describe, expect, it } from 'vitest'

import { githubFullName, parseJiraKey, type Ticket, ticketFields, withTicket } from '@/minimalist/lib/tickets'

describe('parseJiraKey', () => {
	it('reads a key or a browse link', () => {
		expect(parseJiraKey('abc-12')).toBe('ABC-12')
		expect(parseJiraKey('https://acme.atlassian.net/browse/OPS-7')).toBe('OPS-7')
		expect(parseJiraKey('fix OPS-7')).toBeNull()
	})
})

const ticket: Ticket = {
	provider: 'linear',
	ticketId: 'ENG-9',
	name: '[ENG-9] Fix',
	slug: 'eng-9-fix',
	url: null,
	githubRepository: null,
}
const issue: Ticket = {
	provider: 'github',
	ticketId: '42',
	name: '[acme/app#42] Fix',
	slug: 'acme-app-42-fix',
	url: 'https://github.com/acme/app/issues/42',
	githubRepository: {
		connectionId: 'c1',
		repositoryId: '7',
		fullName: 'acme/app',
		accountLogin: 'acme',
		private: false,
		archived: false,
	},
}

describe('withTicket', () => {
	it('points the agent at the imported issue', () => {
		expect(withTicket('Keep it small', 'eng-9-fix', ticket)).toBe(
			'Keep it small\n\nSee @.humanlayer/tasks/eng-9-fix/ENG-9.md',
		)
		expect(withTicket('', 'eng-9-fix', ticket)).toBe('Work on ENG-9. See @.humanlayer/tasks/eng-9-fix/ENG-9.md')
		expect(withTicket('Hi', 'x', null)).toBe('Hi')
	})

	it('names a GitHub issue by repository and number', () => {
		expect(withTicket('', 'acme-app-42-fix', issue)).toBe(
			'Work on acme/app#42. See @.humanlayer/tasks/acme-app-42-fix/acme-app-42.md',
		)
	})
})

describe('ticketFields', () => {
	it('sends the repository only for GitHub issues', () => {
		expect(ticketFields(null)).toEqual({})
		expect(ticketFields(ticket)).toMatchObject({ ticketProvider: 'linear', githubConnectionId: undefined })
		expect(ticketFields(issue)).toMatchObject({
			ticketProvider: 'github',
			ticketId: '42',
			githubConnectionId: 'c1',
			ticketRepositoryId: '7',
			ticketRepositoryFullName: 'acme/app',
		})
	})

	it('reads owner/name from a GitHub project identity', () => {
		expect(githubFullName('github.com/acme/app')).toBe('acme/app')
		expect(githubFullName('gitlab.com/acme/app')).toBeNull()
		expect(githubFullName(undefined)).toBeNull()
	})
})
