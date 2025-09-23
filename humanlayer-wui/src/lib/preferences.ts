// Storage keys
export const ARCHIVE_ON_FORK_KEY = 'archive-source-on-fork'

// Helper functions
export const getArchiveOnForkPreference = (): boolean => {
  const stored = localStorage.getItem(ARCHIVE_ON_FORK_KEY)
  return stored !== 'false' // Default to true
}

export const setArchiveOnForkPreference = (value: boolean): void => {
  localStorage.setItem(ARCHIVE_ON_FORK_KEY, String(value))
}
