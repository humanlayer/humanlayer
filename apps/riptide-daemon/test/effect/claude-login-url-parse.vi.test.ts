import { describe, expect, it } from 'vitest'

import { parseClaudeAuthorizeUrl as capture } from '@/effects/services/provider-login/drivers/claude-login-driver'

const URL = 'https://claude.com/cai/oauth/authorize?code=true&state=abc123'

describe('claude auth login URL parsing', () => {
	it('captures the URL when claude wraps it in an OSC 8 terminal hyperlink', () => {
		// ESC ]8;;<uri> BEL <text> ESC ]8;; BEL — the shape that broke the naive regex.
		const raw = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${URL}\u0007${URL}\u001b]8;;\u0007\nPaste code here if prompted > `
		expect(capture(raw)).toBe(URL)
	})

	it('captures the URL from plain, unstyled output', () => {
		expect(capture(`If the browser didn't open, visit: ${URL}\n`)).toBe(URL)
	})

	it('strips CSI colour codes around the URL', () => {
		expect(capture(`visit: \u001b[36m${URL}\u001b[0m\n`)).toBe(URL)
	})

	it('falls back to an authorize URL when the prompt drops the visit: label', () => {
		expect(capture(`Open this to continue: ${URL}\n`)).toBe(URL)
	})

	it('does not treat an unrelated URL as the sign-in link', () => {
		expect(capture(`See the docs at https://docs.anthropic.com/claude-code\n`)).toBeUndefined()
	})

	it.each([
		`visit: ${URL}\n`,
		`visit: \u001b[36m${URL}\u001b[0m\r\n`,
		`visit: \u001b]8;;${URL}\u0007${URL}\u001b]8;;\u0007\n`,
	])('waits for a complete line at every possible chunk boundary: %s', (line) => {
		for (let offset = 0; offset < line.length; offset++) {
			expect(capture(`Opening browser\n${line.slice(0, offset)}`)).toBeUndefined()
		}
		expect(capture(`Opening browser\n${line}Paste code > `)).toBe(URL)
	})
})
