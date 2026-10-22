import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Theme } from '../components/theme-provider'
import { themeToAppearance } from './theme-appearance-mapping'
import { themeToShiki, themeToShikiInput } from './shiki-theme-mapping'

const restoredThemes = [
	'rapture',
	'tactical',
	'neuromancer',
	'red-alert',
	'covenant',
	'wintermute',
	'dash',
	'wednesday',
] as const satisfies readonly Theme[]

describe('historical Riptide themes', () => {
	test('maps every theme to a bundled GitHub syntax theme', () => {
		for (const theme of restoredThemes) {
			const expected = themeToAppearance[theme] === 'light' ? 'github-light-default' : 'github-dark-default'
			expect(themeToShiki[theme]).toBe(expected)
			expect(themeToShikiInput(theme)).toBe(expected)
		}

		expect(themeToAppearance.dash).toBe('light')
		expect(themeToAppearance.wednesday).toBe('light')
		expect(restoredThemes.filter(theme => themeToAppearance[theme] === 'dark')).toHaveLength(6)
	})

	test('defines complete terminal and ANSI CSS palettes under canonical selectors', () => {
		const cssPath = resolve(process.cwd(), 'src/styles/historical-riptide-themes.css')
		const css = readFileSync(cssPath, 'utf8')
		const requiredTokens = [
			'bg', 'bg-alt', 'fg', 'fg-dim', 'accent', 'accent-dim', 'accent-alt',
			'border', 'success', 'warning', 'error', 'selection',
		]

		for (const theme of restoredThemes) {
			const block = css.match(new RegExp(`:root\\[data-theme=\\"${theme}\\"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1]
			expect(block, `missing CSS block for ${theme}`).toBeDefined()
			for (const token of requiredTokens) expect(block).toContain(`--terminal-${token}:`)
			for (let color = 0; color <= 15; color += 1) expect(block).toContain(`--terminal-color-${color}:`)
		}

		expect(css).not.toContain('[data-theme="redalert"]')
	})
})
