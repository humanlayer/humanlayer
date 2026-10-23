import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Theme } from '../components/theme-provider'
import { vscodeThemes } from '../vscode-themes/generated/vscode-themes.generated'
import { themeToAppearance } from './theme-appearance-mapping'
import { themeToShiki, themeToShikiInput } from './shiki-theme-mapping'

const theme = 'vercel-dark-vscode' as const satisfies Theme

describe('Vercel theme', () => {
	test('registers only the dark theme and uses the standard dark Shiki fallback', () => {
		expect(vscodeThemes).toEqual(expect.arrayContaining([
			expect.objectContaining({ value: theme, label: 'Vercel Dark', type: 'dark' }),
		]))
		expect(vscodeThemes).not.toEqual(expect.arrayContaining([
			expect.objectContaining({ label: 'Vercel Light' }),
		]))

		const input = themeToShikiInput(theme)
		expect(themeToShiki[theme]).toBe('github-dark-default')
		expect(input).toBe('github-dark-default')
		expect(themeToAppearance[theme]).toBe('dark')
	})

	test('uses a neutral UI accent and dedicated label, syntax, and inline code colors', () => {
		const cssPath = resolve(process.cwd(), 'src/vscode-themes/generated/vscode-themes.generated.css')
		const css = readFileSync(cssPath, 'utf8')
		const requiredTokens = [
			'bg', 'bg-alt', 'fg', 'fg-dim', 'accent', 'accent-dim', 'accent-alt',
			'border', 'success', 'warning', 'error', 'selection',
		]
		const block = css.match(new RegExp(`\\[data-theme=["']${theme}["']\\] \\{([\\s\\S]*?)\\n\\}`))?.[1]

		expect(block, `missing CSS block for ${theme}`).toBeDefined()
		for (const token of requiredTokens) expect(block).toContain(`--terminal-${token}:`)
		for (let color = 0; color <= 15; color += 1) expect(block).toContain(`--terminal-color-${color}:`)

		expect(block).toContain('--terminal-accent: #ededed')
		expect(block).toContain('--terminal-accent-alt: #62a6ff')
		expect(block).toContain('--terminal-code-bg: #ffffff1a')
		expect(block).toContain('--terminal-label-green: #58c760')
		expect(block).toContain('--terminal-label-pink: #f05b8d')
		expect(block).toContain('--terminal-label-blue: #62a6ff')
		expect(block).toContain('--terminal-label-purple: #b675f1')
		expect(block).toContain('--syntax-keyword: #f05b8d')
		expect(block).toContain('--syntax-variable: #ededed')
	})
})
