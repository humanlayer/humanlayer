import { daemonService } from '@/services/daemon-service'

// Get daemon URL from environment or managed daemon
export async function getDaemonUrl(): Promise<string> {
  // Check for explicit URL first
  if (import.meta.env.VITE_HUMANLAYER_DAEMON_URL) {
    return import.meta.env.VITE_HUMANLAYER_DAEMON_URL
  }

  // Check if we have a managed daemon
  try {
    const daemonInfo = await daemonService.getDaemonInfo()
    if (daemonInfo && daemonInfo.port) {
      return `http://127.0.0.1:${daemonInfo.port}`
    }
  } catch (error) {
    console.warn('Failed to get managed daemon info:', error)
  }

  // Check for port override
  const port = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_PORT || '7777'
  const host = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_HOST || 'localhost'

  return `http://${host}:${port}`
}

// Headers to include with all requests
export function getDefaultHeaders(): Record<string, string> {
  return {
    'X-Client': 'codelayer',
    'X-Client-Version': import.meta.env.VITE_APP_VERSION || 'unknown',
  }
}
