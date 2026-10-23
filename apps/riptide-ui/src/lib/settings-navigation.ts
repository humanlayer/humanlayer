import type { RouterHistory, useNavigate } from '@tanstack/react-router'

import {
	DEFAULT_SETTINGS_SECTION,
	SETTINGS_SECTION_PATHS,
	type SettingsSection,
} from '@/components/settings/settings-sections'

/** A TanStack Router navigate function, as returned by `useNavigate()`. */
export type NavigateFn = ReturnType<typeof useNavigate>

/**
 * Navigate to a settings section route, e.g. `/settings/general`.
 *
 * Every settings entry point (hotkey, footer gear, command palette, toasts,
 * banners, post-checkout redirect) routes through this helper so the active
 * section is encoded in the URL instead of imperative modal state. When no
 * section is provided it lands on {@link DEFAULT_SETTINGS_SECTION}, matching the
 * modal's old "open with no tab" behavior.
 */
export function navigateToSettings(navigate: NavigateFn, section?: SettingsSection): void {
	navigate({ to: SETTINGS_SECTION_PATHS[section ?? DEFAULT_SETTINGS_SECTION] })
}

/** Navigate between settings sections without adding another history entry. */
export function navigateWithinSettings(navigate: NavigateFn, section: SettingsSection): void {
	navigate({ to: SETTINGS_SECTION_PATHS[section], replace: true })
}

/**
 * Navigate back out of settings to the main app.
 *
 * Used by the settings sidebar "Back to app" button and the settings `Esc`
 * handler so both return to the page that opened settings.
 */
export function navigateBackFromSettings(history: Pick<RouterHistory, 'back' | 'canGoBack' | 'replace'>): void {
	if (history.canGoBack()) {
		history.back()
		return
	}

	history.replace('/')
}
