import { describe, expect, it } from 'vitest'

import { buildAttributedPrompt } from './session-prompt-attribution'

describe('buildAttributedPrompt', () => {
	it('leaves a turn bare when multiplayer prompting is off', () => {
		const prompt = buildAttributedPrompt([
			{ content: 'first', authorDisplayName: 'Pepijn Senders', multiplayerPromptingActive: false },
			{ content: 'second', authorDisplayName: null, multiplayerPromptingActive: null },
		])

		expect(prompt).toBe('first\n\nsecond')
	})

	it('wraps every message once multiplayer prompting is on, the owner included', () => {
		const prompt = buildAttributedPrompt([
			{ content: 'rename the button', authorDisplayName: 'Pepijn Senders', multiplayerPromptingActive: true },
			{
				content: 'and fix the empty state',
				authorDisplayName: 'Dexter Horthy',
				multiplayerPromptingActive: true,
			},
		])

		expect(prompt).toBe(
			'<message from="Pepijn Senders">\nrename the button\n</message>\n\n' +
				'<message from="Dexter Horthy">\nand fix the empty state\n</message>',
		)
	})

	it('wraps without an author when the display name is unknown', () => {
		const prompt = buildAttributedPrompt([
			{ content: 'from a stranger', authorDisplayName: null, multiplayerPromptingActive: true },
		])

		expect(prompt).toBe('<message>\nfrom a stranger\n</message>')
	})

	it('mixes wrapped and bare messages by their own flag', () => {
		const prompt = buildAttributedPrompt([
			{ content: 'queued before sharing', authorDisplayName: null, multiplayerPromptingActive: false },
			{ content: 'queued after sharing', authorDisplayName: 'Dexter Horthy', multiplayerPromptingActive: true },
		])

		expect(prompt).toBe('queued before sharing\n\n<message from="Dexter Horthy">\nqueued after sharing\n</message>')
	})

	it('escapes markup in display names', () => {
		const prompt = buildAttributedPrompt([
			{ content: 'hi', authorDisplayName: 'Ann "Quotes" <&> Smith', multiplayerPromptingActive: true },
		])

		expect(prompt).toBe('<message from="Ann &quot;Quotes&quot; &lt;&amp;&gt; Smith">\nhi\n</message>')
	})
})
