// Get daemon URL from environment or default
export function getDaemonUrl(): string {
  // Check for explicit URL first
  if (import.meta.env.VITE_HUMANLAYER_DAEMON_URL) {
    return import.meta.env.VITE_HUMANLAYER_DAEMON_URL
  }

  // Check for port override
  const port = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_PORT || '7777'
  const host = import.meta.env.VITE_HUMANLAYER_DAEMON_HTTP_HOST || 'localhost'

  return `http://${host}:${port}`
}

// Headers to include with all requests
export function getDefaultHeaders(): Record<string, string> {
  return {
    'X-Client': 'wui',
    'X-Client-Version': import.meta.env.VITE_APP_VERSION || 'unknown',
  }
}
