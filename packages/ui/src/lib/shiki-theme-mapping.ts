import type { Theme } from '../components/theme-provider'
import { themeToAppearance } from './theme-appearance-mapping'

/**
 * Every app theme highlights diffs with GitHub's current Primer Shiki themes:
 * the palette-matched bundled themes proved too low-contrast for review. The
 * `-default` variants match github.com exactly — near-black #0d1117 in dark,
 * white in light — unlike the legacy `github-dark` (#24292e gray-green).
 */
export const DIFF_SHIKI_DARK = 'github-dark-default'
export const DIFF_SHIKI_LIGHT = 'github-light-default'

export const themeToShiki: Record<Theme, string> = Object.fromEntries(
	(Object.entries(themeToAppearance) as [Theme, 'light' | 'dark'][]).map(([theme, appearance]) => [
		theme,
		appearance === 'light' ? DIFF_SHIKI_LIGHT : DIFF_SHIKI_DARK,
	]),
) as Record<Theme, string>

export type ShikiThemeInput = string

const FALLBACK_SHIKI_THEME = DIFF_SHIKI_DARK

/**
 * Resolve the app theme to a bundled Shiki theme. This uses the same mapping as
 * @pierre/diffs so markdown code blocks match the diff viewer.
 */
export function themeToShikiInput(theme: Theme | undefined): ShikiThemeInput {
	if (!theme) return FALLBACK_SHIKI_THEME
	return themeToShiki[theme] ?? FALLBACK_SHIKI_THEME
}

/** Code fences use the same high-contrast Primer palettes as diffs. */
export function themeToCodeFenceShiki(theme: Theme | undefined): string {
	return theme ? themeToShiki[theme] : DIFF_SHIKI_DARK
}
