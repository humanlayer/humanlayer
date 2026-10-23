import { isElectron, isTauri } from '@/lib/utils'

/**
 * Layout helpers for desktop overlay window chrome.
 *
 * The desktop app runs with `titleBarStyle: "Overlay"` + `hiddenTitle`, so the
 * renderer owns the entire window surface and the macOS traffic lights float over
 * the top-left corner. Instead of reserving an empty titlebar strip, the app's
 * own top rows (sidebar header, breadcrumb, fullscreen artifact header) act as
 * the drag region via `data-tauri-drag-region` and inset their content where the
 * traffic lights sit.
 *
 * These helpers are for layout decisions only — they can be dev-forced in a
 * plain browser for screenshots. Anything that calls real Tauri APIs must keep
 * using `isTauri()`.
 */

const FORCE_FLAG = 'forceTauriChrome'
const FORCE_STORAGE_KEY = `dev:${FORCE_FLAG}`

let cachedForce: boolean | null = null

/**
 * Dev override: `?forceTauriChrome=1` in the URL (persisted to localStorage so
 * it survives client-side navigation) or `localStorage['dev:forceTauriChrome']`.
 * `?forceTauriChrome=0` clears it.
 */
function isForcedTauriChrome(): boolean {
	if (typeof window === 'undefined') return false
	if (cachedForce !== null) return cachedForce
	try {
		const param = new URLSearchParams(window.location.search).get(FORCE_FLAG)
		if (param !== null) {
			const enabled = param !== '0'
			window.localStorage.setItem(FORCE_STORAGE_KEY, enabled ? '1' : '0')
			cachedForce = enabled
			return cachedForce
		}
		cachedForce = window.localStorage.getItem(FORCE_STORAGE_KEY) === '1'
	} catch {
		cachedForce = false
	}
	return cachedForce
}

/** Whether the window uses desktop overlay titlebar chrome (or a dev-forced preview of it). */
export function hasTauriChrome(): boolean {
	return isTauri() || isElectron() || isForcedTauriChrome()
}

const IS_MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

/**
 * Whether macOS traffic lights overlay the window's top-left corner. Forced
 * (browser preview) mode always previews the macOS chrome, since that is the
 * layout being screenshotted.
 */
export function hasMacWindowControls(): boolean {
	if (!hasTauriChrome()) return false
	return isTauri() || isElectron() ? IS_MAC : true
}

/** Dev-only: render fake traffic lights so browser screenshots match the macOS window. */
export function showsFakeWindowControls(): boolean {
	return isForcedTauriChrome() && !isTauri() && !isElectron()
}

/** Left padding that clears the macOS traffic lights (~65px of dots + breathing room). */
export const MAC_WINDOW_CONTROLS_INSET_CLASS = 'pl-19'

/**
 * Roomier variant for headers whose first element is a bordered control (the
 * fullscreen artifact switcher) rather than plain text — the extra 1.5rem keeps
 * the control from crowding the traffic lights.
 */
export const MAC_WINDOW_CONTROLS_INSET_WIDE_CLASS = 'pl-25'
