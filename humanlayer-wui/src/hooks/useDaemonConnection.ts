import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient } from '@/lib/daemon/client'
import { formatError } from '@/utils/errors'
import { daemonService } from '@/services/daemon-service'
import { TIMING } from '@/lib/constants'

interface UseDaemonConnectionReturn {
  connected: boolean
  connecting: boolean
  error: string | null
  version: string | null
  connect: () => Promise<void>
  reconnect: () => Promise<void>
  checkHealth: () => Promise<void>
}

export function useDaemonConnection(): UseDaemonConnectionReturn {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const retryCount = useRef(0)

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
    if (connecting) return

    setConnecting(true)
    setError(null)

    try {
      await daemonClient.connect()
      const health = await daemonClient.health()

      setConnected(true)
      setVersion(health.version)
      retryCount.current = 0
    } catch (err: any) {
      setConnected(false)

      // Check if this is first failure and we have a managed daemon
      if (retryCount.current === 0) {
        const isManaged = await daemonService.isDaemonRunning()
        if (!isManaged) {
          // Let DaemonManager handle it
          setError(formatError(err))
        } else {
          // Managed daemon might be starting, retry
          retryCount.current++
          setTimeout(() => connect(), 2000)
        }
      } else {
        setError(formatError(err))
      }
    } finally {
      setConnecting(false)
    }
  }, [])

  const reconnect = useCallback(async () => {
    try {
      setConnecting(true)
      setError(null)
      setConnected(false)

      await daemonClient.reconnect()
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

    const interval = setInterval(checkHealth, TIMING.CONNECTION_HEALTH_CHECK_INTERVAL) // Regular health checks

    return () => clearInterval(interval)
  }, [connected, checkHealth])

  return {
    connected,
    connecting,
    error,
    version,
    connect,
    reconnect,
    checkHealth,
  }
}
