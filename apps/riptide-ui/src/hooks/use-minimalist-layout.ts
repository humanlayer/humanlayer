import { useLocation, useNavigate } from '@tanstack/react-router'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { type TaskViewLayout, useTaskViewPreferencesStore } from '@/hooks/stores/taskViewPreferencesStore'

export function supportsMinimalistLayout(pathname: string, search: Record<string, unknown> = {}): boolean {
	if (pathname === '/tasks/new' || pathname === '/sessions/draft' || search.tab) return false
	// Document and diff links open the side panel here, and ?focus=workspace lands on the thread, which shows
	// workspace setup in place. Comment links without a document keep the standard viewers.
	if ((search.comment || search.commentId) && !search.artifactId) return false
	return (
		pathname === '/' ||
		pathname === '/pull-requests' ||
		pathname === '/board' ||
		pathname === '/artifacts' ||
		// The minimalist archive lives in settings; these routes send it there.
		pathname === '/archive/tasks' ||
		pathname === '/archive/sessions' ||
		/^\/(tasks|sessions)\/[^/]+\/?$/.test(pathname) ||
		pathname === '/settings' ||
		pathname.startsWith('/settings/')
	)
}

/** `?minimal_ui=true|false` (or the short `?minui=`) overrides the setting, which keeps tests and shared links deterministic. */
export function minimalistLayoutOverride(search: Record<string, unknown>): boolean | undefined {
	const value = search.minimal_ui ?? search.minui
	if (value === true || value === 'true') return true
	if (value === false || value === 'false') return false
	return undefined
}

const TAB_OVERRIDE_KEY = 'hl-minimal-ui'

/** The override lasts for the browser tab, so in-app navigation that drops the query keeps the same interface. */
function tabOverride(search: Record<string, unknown>): boolean | undefined {
	const fromUrl = minimalistLayoutOverride(search)
	try {
		if (fromUrl !== undefined) {
			if (sessionStorage.getItem(TAB_OVERRIDE_KEY) !== String(fromUrl))
				sessionStorage.setItem(TAB_OVERRIDE_KEY, String(fromUrl))
			return fromUrl
		}
		const stored = sessionStorage.getItem(TAB_OVERRIDE_KEY)
		return stored === null ? undefined : stored === 'true'
	} catch {
		return fromUrl
	}
}

export function useMinimalistLayout(): boolean {
	const enabled = useSettingsStore((state) => state.minimalistUiEnabled)
	const location = useLocation()
	const search = location.search as Record<string, unknown>
	return (tabOverride(search) ?? enabled) && supportsMinimalistLayout(location.pathname, search)
}

/**
 * The board has a route in the minimalist interface but is a layout of the tasks page in the standard
 * one, so switching from either board lands on the other. Returns where to go, or null to stay put.
 */
export function boardCounterpart(
	pathname: string,
	search: Record<string, unknown>,
	toMinimalist: boolean,
	layout: TaskViewLayout,
): '/board' | '/' | null {
	const tasksTab = search.tab === undefined || search.tab === 'tasks' || search.tab === 'kanban'
	if (toMinimalist && pathname === '/' && tasksTab && (layout === 'board' || search.tab === 'kanban')) return '/board'
	if (!toMinimalist && pathname === '/board') return '/'
	return null
}

/**
 * Flip between the minimalist and standard interfaces from whichever is on screen. The setting changes,
 * and a per-tab override from `?minimal_ui` or `?minui` is cleared so it can't force the old one back.
 * Either board opens the other.
 */
export function useToggleMinimalistLayout(): () => void {
	const navigate = useNavigate()
	const location = useLocation()
	return () => {
		const search = location.search as Record<string, unknown>
		const settings = useSettingsStore.getState()
		const next = !(tabOverride(search) ?? settings.minimalistUiEnabled)
		try {
			sessionStorage.removeItem(TAB_OVERRIDE_KEY)
		} catch {
			// Without storage there is no tab override to clear.
		}
		settings.setMinimalistUiEnabled(next)
		const preferences = useTaskViewPreferencesStore.getState()
		const board = boardCounterpart(location.pathname, search, next, preferences.layout)
		if (board === '/') preferences.setLayout('board')
		if (board) {
			void navigate({ to: board, search: {} })
			return
		}
		if ('minimal_ui' in search || 'minui' in search)
			void navigate({
				to: '.',
				search: (previous) => {
					const { minimal_ui: _minimalUi, minui: _minui, ...rest } = previous as Record<string, unknown>
					return rest
				},
				replace: true,
			})
	}
}
