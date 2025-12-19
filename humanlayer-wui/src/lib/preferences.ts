// Storage keys
export const ARCHIVE_ON_FORK_KEY = 'archive-source-on-fork'
export const ABOUT_WELCOME_SEEN = 'about-welcome-seen'

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

// Draft Launcher helper functions
export function getDraftLauncherDefaults() {
  return {
    bypassPermissions: false,
    autoAccept: false,
  }
}
