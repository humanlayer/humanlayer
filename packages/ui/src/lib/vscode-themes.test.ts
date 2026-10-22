import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import { themeToAppearance } from './theme-appearance-mapping'

const requiredTokens = [
	'bg', 'bg-alt', 'fg', 'fg-dim', 'accent', 'accent-dim', 'accent-alt',
	'border', 'success', 'warning', 'error', 'selection',
]

function themeBlock(css: string, theme: string): string | undefined {
	return css.match(new RegExp(`\\[data-theme=["']${theme}["']\\] \\{([\\s\\S]*?)\\n\\}`))?.[1]
}

describe('theme terminal token contract', () => {
	test('provides the shared inline-code background fallback for themes without an override', () => {
		const cssPath = resolve(process.cwd(), 'src/styles/globals.css')
		const css = readFileSync(cssPath, 'utf8')

		expect(css).toContain('--terminal-code-bg: var(--terminal-bg-alt);')
	})

	test('defines every terminal semantic and ANSI color consumed by the UI', () => {
		const css = [
			'src/styles/globals.css',
			'src/styles/historical-riptide-themes.css',
			'src/vscode-themes/generated/vscode-themes.generated.css',
		]
			.map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
			.join('\n')

		for (const theme of Object.keys(themeToAppearance)) {
			const block = themeBlock(css, theme)
			expect(block, `missing CSS block for ${theme}`).toBeDefined()
			for (const token of requiredTokens) expect(block).toContain(`--terminal-${token}:`)
			for (let color = 0; color <= 15; color += 1) expect(block).toContain(`--terminal-color-${color}:`)
		}
	})

	test('falls back to ANSI green when a theme omits an editor success token', () => {
		const cssPath = resolve(process.cwd(), 'src/vscode-themes/generated/vscode-themes.generated.css')
		const css = readFileSync(cssPath, 'utf8')

		expect(themeBlock(css, 'night-owl-light-vscode')).toContain('--terminal-success: #08916a')
		expect(themeBlock(css, 'nord-vscode')).toContain('--terminal-success: #a3be8c')
	})
})
