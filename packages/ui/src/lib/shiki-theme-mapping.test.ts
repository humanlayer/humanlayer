import { describe, expect, test } from 'vitest'
import type { Theme } from '../components/theme-provider'
import { themeToAppearance } from './theme-appearance-mapping'
import { themeToShiki, themeToShikiInput } from './shiki-theme-mapping'

describe('Shiki theme mapping', () => {
	test('maps every app theme to the GitHub default theme for its appearance', () => {
		for (const [theme, appearance] of Object.entries(themeToAppearance) as [Theme, 'light' | 'dark'][]) {
			const expected = appearance === 'light' ? 'github-light-default' : 'github-dark-default'
			expect(themeToShiki[theme]).toBe(expected)
			expect(themeToShikiInput(theme)).toBe(expected)
		}
	})

	test('falls back to github-dark-default for unknown themes', () => {
		expect(themeToShikiInput(undefined)).toBe('github-dark-default')
	})
})
