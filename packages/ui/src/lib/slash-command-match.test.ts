import { describe, expect, it } from 'vitest'

import type { SlashCommand } from '@humanlayer/ui/components/slash-command-list'
import { matchSlashCommands } from '@humanlayer/ui/lib/slash-command-match'

const COMMANDS: SlashCommand[] = [
	{ name: '/compact', source: 'bundled', startOfMessageOnly: true },
	{ name: '/hl:show-me', source: 'bundled' },
	{ name: '/rpi:create-research', source: 'bundled' },
	{ name: '/rpi:iterate-research', source: 'bundled' },
]

const names = (query: string, atStartOfMessage = true) =>
	matchSlashCommands(COMMANDS, query, { atStartOfMessage }).map((command) => command.name)

describe('matchSlashCommands', () => {
	it('returns every command for an empty query', () => {
		expect(matchSlashCommands(COMMANDS, '', { atStartOfMessage: true })).toHaveLength(COMMANDS.length)
	})

	it('matches a prefix of the whole name', () => {
		expect(names('comp')).toEqual(['/compact'])
	})

	// `/compact` is read by the agent only at the start of a message, so offering it
	// mid-sentence would insert something that quietly does nothing.
	describe('start-of-message commands', () => {
		it('offers them when the slash starts the message', () => {
			expect(names('comp', true)).toEqual(['/compact'])
		})

		it('hides them anywhere else', () => {
			expect(names('comp', false)).toEqual([])
		})

		it('hides them from the unfiltered list too', () => {
			expect(names('', false)).not.toContain('/compact')
			expect(names('', true)).toContain('/compact')
		})

		it('leaves ordinary commands alone', () => {
			expect(names('research', false)).toEqual(['/rpi:create-research', '/rpi:iterate-research'])
		})
	})

	it('matches a prefix of a segment after : or -', () => {
		expect(names('research')).toEqual(['/rpi:create-research', '/rpi:iterate-research'])
		expect(names('show')).toEqual(['/hl:show-me'])
	})

	it('matches across a segment boundary', () => {
		expect(names('create-research')).toEqual(['/rpi:create-research'])
		expect(names('rpi:create')).toEqual(['/rpi:create-research'])
	})

	it('ignores case', () => {
		expect(names('COMPACT')).toEqual(['/compact'])
	})

	it('ranks whole-name matches above segment matches', () => {
		expect(names('r')[0]).toBe('/rpi:create-research')
	})

	describe('description matching', () => {
		const withDescriptions: SlashCommand[] = [
			{ name: '/compact', source: 'bundled', description: 'Summarize the conversation' },
			{ name: '/summary', source: 'local' },
			{ name: '/review', source: 'local', description: 'Review a pull request' },
		]
		const search = (query: string) =>
			matchSlashCommands(withDescriptions, query, { atStartOfMessage: true }).map((c) => c.name)

		it('finds a command by a word in its description', () => {
			expect(search('summarize')).toEqual(['/compact'])
			expect(search('pull')).toEqual(['/review'])
		})

		it('ranks every name match above every description match', () => {
			expect(search('summ')).toEqual(['/summary', '/compact'])
		})

		it('anchors description matches to a word boundary', () => {
			expect(search('onversation')).toEqual([])
		})

		it('ignores descriptions when the command has none', () => {
			expect(search('request')).toEqual(['/review'])
		})
	})

	// The bug this matcher exists to prevent: a path segment must not match a command,
	// or the menu opens over the path and the next Enter replaces it.
	it('does not match a path segment as a subsequence', () => {
		expect(names('home')).toEqual([])
		expect(names('tmp')).toEqual([])
		expect(names('users')).toEqual([])
		expect(names('rpi-notes')).toEqual([])
	})
})
