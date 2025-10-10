// Storage keys
export const ARCHIVE_ON_FORK_KEY = 'archive-source-on-fork'
export const PREFERRED_EDITOR_KEY = 'preferred-editor'

// Draft Launcher preference keys
export const DRAFT_LAUNCHER_PREFS = {
  BYPASS_PERMISSIONS: 'draft-launcher-bypass-permissions',
  AUTO_ACCEPT: 'draft-launcher-auto-accept',
} as const

// Editor options
export type EditorType = 'cursor' | 'code' | 'zed'

export const EDITOR_OPTIONS: { value: EditorType; label: string; command: string }[] = [
  { value: 'cursor', label: 'Cursor', command: 'cursor' },
  { value: 'code', label: 'VS Code', command: 'code' },
  { value: 'zed', label: 'Zed', command: 'zed' },
]

// Helper functions
export const getArchiveOnForkPreference = (): boolean => {
  const stored = localStorage.getItem(ARCHIVE_ON_FORK_KEY)
  return stored !== 'false' // Default to true
}

export const setArchiveOnForkPreference = (value: boolean): void => {
  localStorage.setItem(ARCHIVE_ON_FORK_KEY, String(value))
}

export const getPreferredEditor = (): EditorType => {
  const stored = localStorage.getItem(PREFERRED_EDITOR_KEY)
  return (stored as EditorType) || 'cursor' // Default to cursor
}

export const setPreferredEditor = (editor: EditorType): void => {
  localStorage.setItem(PREFERRED_EDITOR_KEY, editor)
}

// Draft Launcher helper functions
export function getDraftLauncherDefaults() {
  return {
    bypassPermissions: false,
    autoAccept: false,
  }
}
