import { daemonService } from '@/services/daemon-service'
import { logger } from '@/lib/logging'
import { getAppVersion } from '@/lib/version'
import { isTauri } from '@/lib/utils'

const DAEMON_URL_STORAGE_KEY = 'codelayer.daemon.url'

// Get daemon URL from environment or managed daemon
export async function getDaemonUrl(): Promise<string> {
  // Check for custom URL from debug panel first
  if ((window as any).__HUMANLAYER_DAEMON_URL) {
    return (window as any).__HUMANLAYER_DAEMON_URL
  }

  // Check localStorage for persisted URL (only when not in Tauri)
  if (!isTauri() && typeof window !== 'undefined') {
    const storedUrl = localStorage.getItem(DAEMON_URL_STORAGE_KEY)
    if (storedUrl) {
      logger.log('Using daemon URL from localStorage:', storedUrl)
      return storedUrl
    }
  }

  // Check for explicit URL from environment
  if (import.meta.env.VITE_HUMANLAYER_DAEMON_URL) {
    return import.meta.env.VITE_HUMANLAYER_DAEMON_URL
  }

  // Check if we have a managed daemon
  try {
    const daemonInfo = await daemonService.getDaemonInfo()
    if (daemonInfo && daemonInfo.port) {
      return `http://localhost:${daemonInfo.port}`
    }
  } catch (error) {
    logger.warn('Failed to get managed daemon info:', error)
  }

  // Check for port override
  const port = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_PORT || '7777'
  const host = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_HOST || 'localhost'

  return `http://${host}:${port}`
}

// Store daemon URL to localStorage (only when not in Tauri)
export function storeDaemonUrl(url: string): void {
  if (!isTauri() && typeof window !== 'undefined') {
    localStorage.setItem(DAEMON_URL_STORAGE_KEY, url)
    logger.log('Stored daemon URL to localStorage:', url)
  }
}

// Clear stored daemon URL from localStorage
export function clearStoredDaemonUrl(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(DAEMON_URL_STORAGE_KEY)
    logger.log('Cleared daemon URL from localStorage')
  }
}

// Headers to include with all requests
export function getDefaultHeaders(): Record<string, string> {
  return {
    'X-Client': 'codelayer',
    'X-Client-Version': getAppVersion(), // Use standardized version (e.g., "0.1.0-20250910-143022-nightly")
  }
}
