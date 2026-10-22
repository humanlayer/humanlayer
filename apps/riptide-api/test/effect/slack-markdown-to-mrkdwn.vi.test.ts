import { describe, expect, it } from 'vitest'

import { markdownToMrkdwn } from '../../src/effects/services/slack/markdown-to-mrkdwn'

describe('markdownToMrkdwn', () => {
	it('returns empty string for empty input', () => {
		expect(markdownToMrkdwn('')).toBe('')
	})

	it('converts the reported regression: **bold** → *bold*', () => {
		expect(markdownToMrkdwn('**this** is good')).toBe('*this* is good')
	})

	it('converts emphasis variants to Slack flavor', () => {
		expect(markdownToMrkdwn('*italic*')).toBe('_italic_')
		expect(markdownToMrkdwn('__underline__')).toBe('*underline*')
		expect(markdownToMrkdwn('~~struck~~')).toBe('~struck~')
		// Bold + italic collapses to Slack's combined form rather than fighting over asterisks.
		expect(markdownToMrkdwn('***wow***')).toBe('*_wow_*')
	})

	it('converts links and images', () => {
		expect(markdownToMrkdwn('[click](https://example.com)')).toBe('<https://example.com|click>')
		expect(markdownToMrkdwn('![alt](https://example.com/i.png)')).toBe('<https://example.com/i.png>')
	})

	it('renders headings as bold', () => {
		expect(markdownToMrkdwn('# Heading')).toBe('*Heading*')
		expect(markdownToMrkdwn('### Heading')).toBe('*Heading*')
		expect(markdownToMrkdwn('###### Heading')).toBe('*Heading*')
	})

	it('converts list markers and task lists', () => {
		expect(markdownToMrkdwn('- one\n* two')).toBe('• one\n• two')
		expect(markdownToMrkdwn('- [ ] todo\n- [x] done')).toBe('• ☐ todo\n• ☑ done')
	})

	it('converts horizontal rules', () => {
		expect(markdownToMrkdwn('---')).toBe('──────────')
	})

	it('leaves inline code and already-mrkdwn syntax untouched', () => {
		expect(markdownToMrkdwn('use `npm run build` now')).toBe('use `npm run build` now')
		expect(markdownToMrkdwn('plain text, no markup')).toBe('plain text, no markup')
	})

	it('does not convert Markdown inside fenced code blocks', () => {
		const input = ['```ts', 'const x = `**not bold**`', '```', '**bold**'].join('\n')
		const output = markdownToMrkdwn(input)
		expect(output).toContain('const x = `**not bold**`') // untouched inside the fence
		expect(output).toContain('*bold*') // converted outside the fence
	})

	it('handles multiple emphasis spans on one line without bleeding', () => {
		expect(markdownToMrkdwn('**a** and **b**')).toBe('*a* and *b*')
	})
})
