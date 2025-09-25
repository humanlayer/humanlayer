export const HOTKEY_SCOPES = {
  GLOBAL: '*',
  ROOT: '.',
  SESSIONS: 'sessions',
  SESSIONS_ARCHIVED: 'sessions.archived',
  SESSION_DETAIL: 'sessions.details',
  SESSION_DETAIL_ARCHIVED: 'sessions.details.archived',
  SESSION_DETAIL_DRAFT: 'sessions.details.draft',
  SESSION_DETAIL_FORK_IN_PROGRESS: 'sessions.details.forkInProgress',
  FORK_MODAL: 'sessions.details.forkModal',
  TOOL_RESULT_MODAL: 'sessions.details.toolResultModal',
  BYPASS_PERMISSIONS_MODAL: 'sessions.details.bypassPermissionsModal',
  SELECT_MODEL_MODAL: 'sessions.details.selectModelModal',
  THEME_SELECTOR: 'themeSelector',
  KEYBOARD_HELPER: 'keyboardHelper',
  SETTINGS_MODAL: 'settingsModal',
  TITLE_EDITING: 'titleEditing',
  ADDITIONAL_DIRECTORIES: 'additionalDirectories',
  SESSION_LAUNCHER: 'sessions.launcher',
} as const

export type HotkeyScope = (typeof HOTKEY_SCOPES)[keyof typeof HOTKEY_SCOPES]
