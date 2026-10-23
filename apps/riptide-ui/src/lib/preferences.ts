// Re-export EditorType and ModelType from the store for backwards compatibility
export type { EditorType, ModelType } from '@/hooks/stores/settingsStore'

// Editor options for display (used by the General settings section)
export const EDITOR_OPTIONS = [
	{ value: 'system' as const, label: 'System Default', description: 'Use system default application' },
	{ value: 'cursor' as const, label: 'Cursor', description: 'AI-first code editor' },
	{ value: 'code' as const, label: 'VS Code', description: 'Visual Studio Code' },
	{ value: 'zed' as const, label: 'Zed', description: 'High-performance code editor' },
] as const

export { AGENT_LABELS, AGENT_OPTIONS, type AgentOption } from '@humanlayer/ui/constants/agents'
export { MODEL_OPTIONS } from '@humanlayer/ui/constants/models'
export { getVisibleProviderOptions, PROVIDER_OPTIONS } from '@humanlayer/ui/constants/providers'

// Working directory persistence for the session launcher is scoped to both the
// host and task. The task launcher has a separate per-host preference.
export const LAST_SESSION_WORKING_DIR_KEY_PREFIX = 'riptide-last-session-working-dir-'
export const LAST_TASK_LAUNCHER_WORKING_DIR_KEY_PREFIX = 'riptide-last-task-launcher-working-dir-'
export const LAST_TASK_LAUNCHER_LOCATION_KEY_PREFIX = 'riptide-last-task-launcher-location-'

export type TaskLauncherLocation = { type: 'directory'; directory: string } | { type: 'project'; projectId: string }

function sessionWorkingDirKey(hostKey: string, taskId: string): string {
	return `${LAST_SESSION_WORKING_DIR_KEY_PREFIX}${hostKey}.${taskId}`
}

export function getLastSessionWorkingDir(hostKey: string, taskId: string): string | null {
	return localStorage.getItem(sessionWorkingDirKey(hostKey, taskId))
}

export function setLastSessionWorkingDir(hostKey: string, taskId: string, dir: string): void {
	localStorage.setItem(sessionWorkingDirKey(hostKey, taskId), dir.trim())
}

export function getLastTaskLauncherWorkingDir(hostKey: string): string | null {
	return localStorage.getItem(`${LAST_TASK_LAUNCHER_WORKING_DIR_KEY_PREFIX}${hostKey}`)
}

export function setLastTaskLauncherWorkingDir(hostKey: string, dir: string): void {
	const directory = dir.trim()
	localStorage.setItem(`${LAST_TASK_LAUNCHER_WORKING_DIR_KEY_PREFIX}${hostKey}`, directory)
	setLastTaskLauncherLocation(hostKey, { type: 'directory', directory })
}

export function getLastTaskLauncherLocation(hostKey: string): TaskLauncherLocation | null {
	const value = localStorage.getItem(`${LAST_TASK_LAUNCHER_LOCATION_KEY_PREFIX}${hostKey}`)
	if (!value) {
		const directory = getLastTaskLauncherWorkingDir(hostKey)
		return directory ? { type: 'directory', directory } : null
	}
	try {
		const parsed: unknown = JSON.parse(value)
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			((Reflect.get(parsed, 'type') === 'directory' && typeof Reflect.get(parsed, 'directory') === 'string') ||
				(Reflect.get(parsed, 'type') === 'project' && typeof Reflect.get(parsed, 'projectId') === 'string'))
		) {
			return parsed as TaskLauncherLocation
		}
	} catch {
		// Ignore malformed browser storage and fall back to configured defaults.
	}
	return null
}

export function setLastTaskLauncherLocation(hostKey: string, location: TaskLauncherLocation): void {
	localStorage.setItem(`${LAST_TASK_LAUNCHER_LOCATION_KEY_PREFIX}${hostKey}`, JSON.stringify(location))
}

// Draft launcher preference keys for persisting user defaults
export const DRAFT_LAUNCHER_PERMISSIONS_MODE_KEY = 'riptide-draft-permissions-mode'

// Usage-limit notice dismiss tracking (all sessions), keyed by usage window and reset time
export const USAGE_LIMIT_NOTICE_DISMISSED_KEY = 'riptide-usage-limit-notice-dismissed'

// Phase tip preferences
export const DISMISSED_TIP_TYPES_KEY = 'riptide-dismissed-tip-types'
export const TIPS_SILENCED_KEY = 'riptide-tips-silenced'
export const TIP_MODAL_SHOWN_SESSIONS_KEY = 'riptide-tip-modal-shown-sessions'

// Iterate confirmation dialog preference
export const ITERATE_DIALOG_SILENCED_KEY = 'riptide-iterate-dialog-silenced'

// First-session Hotkeys Guide auto-open (shown once, ever)
export const HOTKEYS_GUIDE_SHOWN_KEY = 'riptide-hotkeys-guide-shown'

// Hotkeys Guide playground collapsed state (global)
export const HOTKEYS_PLAYGROUND_COLLAPSED_KEY = 'riptide-hotkeys-playground-collapsed'

// Artifact view mode preference (global, not per-session/task)
export const ARTIFACT_VIEW_MODE_KEY = 'riptide-artifact-view-mode'

// Artifacts list grouping preference: group by frontmatter document type (global)
export const ARTIFACTS_GROUP_BY_TYPE_KEY = 'riptide-artifacts-group-by-type'

// Migration: Convert removed 'minimal' view mode to 'rendered'
// The 'minimal' option was removed - users who had it selected should get 'rendered' instead
export function migrateArtifactViewMode(): void {
	const currentValue = localStorage.getItem(ARTIFACT_VIEW_MODE_KEY)
	// localStorage stores JSON strings, so check for both quoted and unquoted
	if (currentValue === '"minimal"' || currentValue === 'minimal') {
		localStorage.setItem(ARTIFACT_VIEW_MODE_KEY, '"rendered"')
	}
}

// Global left task tree sidebar layout persistence
export const LEFT_SIDEBAR_LAYOUT_STORAGE_KEY = 'riptide-left-sidebar-layout'
export const LEFT_SIDEBAR_PANEL_LAYOUT_KEY = 'riptide-left-sidebar-panel-layout'

// Global right sidebar size preferences (normal and artifact modes)
export const RIGHT_SIDEBAR_SIZE_STORAGE_KEY = 'riptide-right-sidebar-size'

// Transient sidebar content persistence (per-session, stored in sessionStorage)
export const SESSION_SIDEBAR_STATE_KEY_PREFIX = 'riptide-session-sidebar.'

// Task detail layout persistence (per-task)
export const TASK_DETAIL_SELECTED_ARTIFACT_KEY_PREFIX = 'riptide-task-detail-selected-artifact.'
// v3: the tab is now stored only when the user explicitly picks one (default
// is unset/derived), so stale auto-selected values from earlier versions are
// ignored and the data-derived Graph default applies.
export const TASK_DETAIL_SIDEBAR_TAB_KEY_PREFIX = 'riptide-task-detail-sidebar-tab.v3.'
