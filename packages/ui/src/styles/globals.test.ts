import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

test('textarea placeholders stay inside the textarea so a zoomed-in WebKit page shows no sideways scroll bar', () => {
	const css = readFileSync(`${process.cwd()}/src/styles/globals.css`, 'utf8')
	const rule = css.match(/(?:^|\n)\s*textarea::placeholder\s*\{([^}]+)\}/)?.[1]
	expect(rule ?? '').toContain('max-width: 100%')
})
