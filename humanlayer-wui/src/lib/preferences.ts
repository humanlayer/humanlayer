// Storage keys
export const ARCHIVE_ON_FORK_KEY = 'archive-source-on-fork'
export const PREFERRED_EDITOR_KEY = 'preferred-editor'

// Draft Launcher preference keys
export const DRAFT_LAUNCHER_PREFS = {
  BYPASS_PERMISSIONS: 'draft-launcher-bypass-permissions',
  AUTO_ACCEPT: 'draft-launcher-auto-accept',
} as const

// Editor options
export type EditorType = 'default' | 'cursor' | 'code' | 'zed'

export const EDITOR_OPTIONS: {
  value: EditorType
  label: string
  command?: string
  description?: string
}[] = [
  { value: 'cursor', label: 'Cursor', command: 'cursor', description: 'Open in Cursor editor' },
  { value: 'code', label: 'VS Code', command: 'code', description: 'Open in Visual Studio Code' },
  { value: 'zed', label: 'Zed', command: 'zed', description: 'Open in Zed editor' },
  {
    value: 'default',
    label: 'System Default',
    description: "Use your system's default file manager or IDE",
  },
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
  return (stored as EditorType) || 'code' // Default to VS Code
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
