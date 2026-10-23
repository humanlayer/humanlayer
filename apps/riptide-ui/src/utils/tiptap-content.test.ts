import { describe, expect, test } from 'vitest'

import {
	COMPACT_RESPONSE_COMMAND,
	RESPONSE_SLASH_COMMANDS,
	SIMPLE_RESPONSE_RESTATE_COMMAND,
	SIMPLE_RESPONSE_RESTATE_PROMPT,
} from '@/constants/response-slash-commands'

import { getTextFromContent } from './tiptap-content'

describe('simple response restating command', () => {
	test('is available in the response editor slash commands', () => {
		expect(RESPONSE_SLASH_COMMANDS).toContainEqual({
			name: SIMPLE_RESPONSE_RESTATE_COMMAND,
			source: 'bundled',
		})
	})

	test('replaces the badge with the restating prompt', () => {
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'mention', attrs: { id: SIMPLE_RESPONSE_RESTATE_COMMAND, label: '/bro' } }],
				},
			],
		}

		expect(getTextFromContent(content).trim()).toBe(SIMPLE_RESPONSE_RESTATE_PROMPT)
	})

	test('keeps text entered after the badge', () => {
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'mention', attrs: { id: SIMPLE_RESPONSE_RESTATE_COMMAND, label: '/bro' } },
						{ type: 'text', text: ' Focus on the last paragraph.' },
					],
				},
			],
		}

		expect(getTextFromContent(content)).toBe(`${SIMPLE_RESPONSE_RESTATE_PROMPT}\n\n Focus on the last paragraph.`)
	})
})

describe('compact response command', () => {
	test('is available in the response editor slash commands', () => {
		expect(RESPONSE_SLASH_COMMANDS).toContainEqual({
			name: COMPACT_RESPONSE_COMMAND,
			source: 'bundled',
			startOfMessageOnly: true,
		})
	})

	// Claude Code reads /compact only at the start of a message. Offering it later in a
	// message would insert a badge that quietly does nothing, so it has to stay marked.
	test('is marked as usable only at the start of a message', () => {
		const compact = RESPONSE_SLASH_COMMANDS.find((command) => command.name === COMPACT_RESPONSE_COMMAND)
		expect(compact?.startOfMessageOnly).toBe(true)
	})

	test('serializes the badge to the literal command', () => {
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'mention',
							attrs: { id: COMPACT_RESPONSE_COMMAND, label: COMPACT_RESPONSE_COMMAND },
						},
					],
				},
			],
		}

		expect(getTextFromContent(content)).toBe('/compact')
	})

	test('preserves trailing instructions without expanding the command', () => {
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'mention',
							attrs: { id: COMPACT_RESPONSE_COMMAND, label: COMPACT_RESPONSE_COMMAND },
						},
						{ type: 'text', text: ' Preserve verification commands.' },
					],
				},
			],
		}

		expect(getTextFromContent(content)).toBe('/compact Preserve verification commands.')
	})
})

describe('show-me skill command', () => {
	test('expands the mention badge into a skill prompt', () => {
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'mention', attrs: { id: '/hl:show-me', label: '/hl:show-me' } }],
				},
			],
		}

		expect(getTextFromContent(content).trim()).toBe('use the hl:show-me skill')
	})
})

/**
 * The command list is written by hand, so this guards the rule that decides which
 * commands may appear mid-message.
 *
 * getTextFromContent rewrites the skill commands into prose, so those reach the agent
 * as an ordinary prompt and work in any position. A command it passes through unchanged
 * arrives as a literal command instead, which only the agent can act on -- and
 * parseCompactCommand in agentlayer-core matches only at the start of a message. So any
 * command that survives serialization verbatim has to be marked startOfMessageOnly, or
 * the menu will offer it somewhere it silently does nothing.
 */
describe('commands that serialize to a literal command', () => {
	const serializedVerbatim = RESPONSE_SLASH_COMMANDS.filter((command) => {
		const inserted = command.insertText ?? command.name
		const content = {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [{ type: 'mention', attrs: { id: inserted, label: command.name } }],
				},
			],
		}
		return getTextFromContent(content) === inserted
	})

	test('there is at least one, so the check below cannot pass vacuously', () => {
		expect(serializedVerbatim.length).toBeGreaterThan(0)
	})

	test.each(serializedVerbatim.map((command) => [command.name, command] as const))(
		'%s is marked as usable only at the start of a message',
		(_name, command) => {
			expect(command.startOfMessageOnly).toBe(true)
		},
	)
})
