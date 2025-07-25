import { useState, useEffect, useCallback } from 'react'
import { daemonClient } from '@/lib/daemon'
import { formatError } from '@/utils/errors'

interface UseDaemonConnectionReturn {
  connected: boolean
  connecting: boolean
  error: string | null
  version: string | null
  connect: () => Promise<void>
  checkHealth: () => Promise<void>
}

export function useDaemonConnection(): UseDaemonConnectionReturn {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)

  const checkHealth = useCallback(async () => {
    try {
      const response = await daemonClient.health()
      setConnected(response.status === 'ok')
      setVersion(response.version)
      setError(null)
    } catch (err) {
      setConnected(false)
      setVersion(null)
      setError(formatError(err))
    }
  }, [])

  const connect = useCallback(async () => {
    try {
      setConnecting(true)
      setError(null)

      await daemonClient.connect()
      await checkHealth()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setConnecting(false)
    }
  }, [checkHealth])

  // Auto-connect on mount
  useEffect(() => {
    connect()
  }, [connect])

  // Periodic health checks
  useEffect(() => {
    if (!connected) return

    const interval = setInterval(checkHealth, 30000) // Every 30 seconds
    
    return () => clearInterval(interval)
  }, [connected, checkHealth])

  return {
    connected,
    connecting,
    error,
    version,
    connect,
    checkHealth,
  }
}
