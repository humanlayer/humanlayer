/**
 * Version utility module for consistent version handling across the application
 */

/**
 * Get the application version from environment or provide a fallback
 * In production: Uses VITE_APP_VERSION set during build (e.g., "0.1.0-20250910-143022-nightly")
 * In development: Returns "0.1.0-dev"
 */
export function getAppVersion(): string {
  // VITE_APP_VERSION is set during CI/CD build with the full version
  const envVersion = import.meta.env.VITE_APP_VERSION

  if (envVersion && envVersion !== 'unknown') {
    return envVersion
  }

  // In development, return a dev version
  if (import.meta.env.DEV) {
    return '0.1.0-dev'
  }

  // Fallback for any other case
  return '0.1.0-unknown'
}

/**
 * Parse version components from a standardized version string
 */
export function parseVersion(version: string): {
  baseVersion: string
  date?: string
  time?: string
  buildType?: string
} {
  // Match pattern: base-YYYYMMDD-HHMMSS-buildType
  const match = version.match(/^(\d+\.\d+\.\d+)(?:-(\d{8}))?(?:-(\d{6}))?(?:-(.+))?$/)

  if (!match) {
    return { baseVersion: version }
  }

  const [, baseVersion, date, time, buildType] = match

  return {
    baseVersion,
    date,
    time,
    buildType,
  }
}

/**
 * Format a version for display purposes
 */
export function formatVersionForDisplay(version: string): string {
  const parsed = parseVersion(version)

  if (!parsed.date) {
    return parsed.baseVersion
  }

  // Format date as YYYY-MM-DD
  const formattedDate = parsed.date
    ? `${parsed.date.slice(0, 4)}-${parsed.date.slice(4, 6)}-${parsed.date.slice(6, 8)}`
    : ''

  // Format time as HH:MM:SS
  const formattedTime = parsed.time
    ? `${parsed.time.slice(0, 2)}:${parsed.time.slice(2, 4)}:${parsed.time.slice(4, 6)}`
    : ''

  let display = parsed.baseVersion
  if (formattedDate) {
    display += ` (${formattedDate}`
    if (formattedTime) {
      display += ` ${formattedTime}`
    }
    if (parsed.buildType) {
      display += ` ${parsed.buildType}`
    }
    display += ')'
  }

  return display
}

/**
 * Check if this is a development build
 */
export function isDevelopmentBuild(): boolean {
  const version = getAppVersion()
  return version.includes('-dev') || version.includes('unknown')
}

/**
 * Check if this is a nightly build
 */
export function isNightlyBuild(): boolean {
  const version = getAppVersion()
  return version.includes('-nightly')
}
