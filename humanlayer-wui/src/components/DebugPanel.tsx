import { useState, useEffect } from 'react'
import { daemonService, type DaemonInfo } from '@/services/daemon-service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, RefreshCw, Link, Server } from 'lucide-react'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { logger } from '@/lib/logging'

interface DebugPanelProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DebugPanel({ open, onOpenChange }: DebugPanelProps) {
  const { connected, reconnect } = useDaemonConnection()
  const [isRestarting, setIsRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [connectError, setConnectError] = useState<string | null>(null)
  const [daemonType, setDaemonType] = useState<'managed' | 'external'>('managed')
  const [externalDaemonUrl, setExternalDaemonUrl] = useState<string | null>(null)
  const [daemonInfo, setDaemonInfo] = useState<DaemonInfo | null>(null)

  // Only show in dev mode
  if (!import.meta.env.DEV) {
    return null
  }

  useEffect(() => {
    loadDaemonInfo()
  }, [connected])

  async function loadDaemonInfo() {
    try {
      const info = await daemonService.getDaemonInfo()
      setDaemonInfo(info)
      const type = daemonService.getDaemonType()
      setDaemonType(type)
      if (type === 'external') {
        setExternalDaemonUrl((window as any).__HUMANLAYER_DAEMON_URL || null)
      }
    } catch (error) {
      logger.error('Failed to load daemon info:', error)
    }
  }

  async function handleRestartDaemon() {
    setIsRestarting(true)
    setRestartError(null)

    try {
      // Stop current daemon
      await daemonService.stopDaemon()

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Start new daemon (with rebuild in dev)
      await daemonService.startDaemon(true)

      // Wait for it to be ready
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Reconnect
      await reconnect()
      await loadDaemonInfo()

      setIsRestarting(false)
    } catch (error: any) {
      setRestartError(error.message || 'Failed to restart daemon')
      setIsRestarting(false)
    }
  }

  async function handleConnectToCustom() {
    setConnectError(null)

    try {
      await daemonService.connectToExisting(customUrl)
      await reconnect()
      await loadDaemonInfo()
      setCustomUrl('')
    } catch (error: any) {
      setConnectError(error.message || 'Failed to connect')
    }
  }

  async function handleSwitchToManaged() {
    try {
      await daemonService.switchToManagedDaemon()
      await reconnect()
      await loadDaemonInfo()
    } catch (error: any) {
      setConnectError(error.message || 'Failed to switch to managed daemon')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Debug Panel</DialogTitle>
          <DialogDescription>Advanced daemon management for developers</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Daemon Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Connection</span>
                <span
                  className={`text-sm font-medium ${connected ? 'text-[var(--terminal-success)]' : 'text-[var(--terminal-error)]'}`}
                >
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Daemon Type</span>
                <div className="flex items-center gap-2">
                  <Server className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm font-medium capitalize">{daemonType}</span>
                </div>
              </div>

              {daemonType === 'external' && externalDaemonUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">External URL</span>
                  <span className="text-sm font-mono">{externalDaemonUrl}</span>
                </div>
              )}

              {daemonInfo && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Port</span>
                    <span className="text-sm font-mono">{daemonInfo.port}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Branch</span>
                    <span className="text-sm font-mono">{daemonInfo.branch_id}</span>
                  </div>
                </>
              )}

              {daemonType === 'managed' ? (
                <Button
                  onClick={handleRestartDaemon}
                  disabled={isRestarting}
                  className="w-full"
                  variant="outline"
                >
                  {isRestarting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Restarting Daemon...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Restart Daemon
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleSwitchToManaged} className="w-full" variant="outline">
                  Switch to Managed Daemon
                </Button>
              )}

              {restartError && <p className="text-sm text-destructive">{restartError}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Connect to Existing Daemon</CardTitle>
              <CardDescription className="text-xs">
                Connect to a daemon running on a custom URL
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="url" className="text-sm">
                  Daemon URL
                </Label>
                <Input
                  id="url"
                  type="text"
                  placeholder="http://127.0.0.1:7777"
                  value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)}
                />
              </div>

              <Button
                onClick={handleConnectToCustom}
                disabled={!customUrl}
                className="w-full"
                variant="outline"
              >
                <Link className="mr-2 h-4 w-4" />
                Connect
              </Button>

              {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
