import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient } from '@/lib/daemon'
import { formatError } from '@/utils/errors'
import { daemonService } from '@/services/daemon-service'

interface UseDaemonConnectionReturn {
  connected: boolean
  connecting: boolean
  error: string | null
  version: string | null
  healthStatus: 'ok' | 'degraded' | null
  connect: () => Promise<void>
  reconnect: () => Promise<void>
  checkHealth: () => Promise<void>
}

export function useDaemonConnection(): UseDaemonConnectionReturn {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [healthStatus, setHealthStatus] = useState<'ok' | 'degraded' | null>(null)
  const retryCount = useRef(0)

  const checkHealth = useCallback(async () => {
    try {
      const response = await daemonClient.health()
      setConnected(true) // Connected if we got a response
      setHealthStatus(response.status)
      setVersion(response.version)
      setError(null)
    } catch (err) {
      setConnected(false) // Only false if we can't reach daemon
      setHealthStatus(null)
      setVersion(null)
      setError(await formatError(err))
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
      setHealthStatus(health.status)
      setVersion(health.version)
      retryCount.current = 0
    } catch (err: any) {
      setConnected(false)
      setHealthStatus(null)

      // Check if this is first failure and we have a managed daemon
      if (retryCount.current === 0) {
        const isManaged = await daemonService.isDaemonRunning()
        if (!isManaged) {
          // Let DaemonManager handle it
          setError(await formatError(err))
        } else {
          // Managed daemon might be starting, retry
          retryCount.current++
          setTimeout(() => connect(), 2000)
        }
      } else {
        setError(await formatError(err))
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
      setError(await formatError(err))
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
    healthStatus,
    connect,
    reconnect,
    checkHealth,
  }
}
