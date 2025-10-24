// Storage keys
export const ARCHIVE_ON_FORK_KEY = 'archive-source-on-fork'
export const KEYBOARD_LAYOUT_CHAR_KEY = 'humanlayer-keyboard-layout-char'

// Draft Launcher preference keys
export const DRAFT_LAUNCHER_PREFS = {
  BYPASS_PERMISSIONS: 'draft-launcher-bypass-permissions',
  AUTO_ACCEPT: 'draft-launcher-auto-accept',
} as const

// Helper functions
export const getArchiveOnForkPreference = (): boolean => {
  const stored = localStorage.getItem(ARCHIVE_ON_FORK_KEY)
  return stored !== 'false' // Default to true
}

export const setArchiveOnForkPreference = (value: boolean): void => {
  localStorage.setItem(ARCHIVE_ON_FORK_KEY, String(value))
}

// Keyboard layout helper functions
export const getKeyboardLayoutCharPreference = (): boolean => {
  const stored = localStorage.getItem(KEYBOARD_LAYOUT_CHAR_KEY)
  return stored !== null ? JSON.parse(stored) : false // Default to false for position-based
}

export const setKeyboardLayoutCharPreference = (useKeyChar: boolean): void => {
  localStorage.setItem(KEYBOARD_LAYOUT_CHAR_KEY, JSON.stringify(useKeyChar))
}

// Draft Launcher helper functions
export function getDraftLauncherDefaults() {
  return {
    bypassPermissions: false,
    autoAccept: false,
  }
}
