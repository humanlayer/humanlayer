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
import { Loader2, RefreshCw, Link, Server, Database, Copy } from 'lucide-react'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { logger } from '@/lib/logging'
import { daemonClient } from '@/lib/daemon'
import type { DebugInfo } from '@/lib/daemon/types'
import { toast } from 'sonner'
import { useDebugStore } from '@/stores/useDebugStore'
import { Switch } from '@/components/ui/switch'

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
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)
  const { showDevUrl, setShowDevUrl } = useDebugStore()

  // Helper to format bytes to human-readable size
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  // Helper to copy text to clipboard
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      logger.error('Failed to copy to clipboard:', error)
    }
  }

  useEffect(() => {
    loadDaemonInfo()
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only show in dev mode (moved after hooks)
  if (!import.meta.env.DEV) {
    return null
  }

  async function loadDaemonInfo() {
    try {
      const info = await daemonService.getDaemonInfo()
      setDaemonInfo(info)
      const type = daemonService.getDaemonType()
      setDaemonType(type)
      if (type === 'external') {
        setExternalDaemonUrl((window as any).__HUMANLAYER_DAEMON_URL || null)
      }

      // Fetch debug info if connected
      if (connected) {
        try {
          const dbgInfo = await daemonClient.getDebugInfo()
          console.log('debugInfo', dbgInfo)
          setDebugInfo(dbgInfo)
        } catch (error) {
          logger.error('Failed to load debug info:', error)
          setDebugInfo(null)
        }
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

    let url = customUrl.trim()

    if (!isNaN(Number(url))) {
      url = `http://127.0.0.1:${url}`
    }

    try {
      await daemonService.connectToExisting(url)
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Debug Panel</DialogTitle>
          <DialogDescription>Advanced daemon management for developers</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 md:grid-cols-2">
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
                Connect to a daemon running on a custom URL (or provide a port number).
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

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Developer Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="show-url" className="text-sm">
                  Show URL in Status Bar
                </Label>
                <Switch id="show-url" checked={showDevUrl} onCheckedChange={setShowDevUrl} />
              </div>
            </CardContent>
          </Card>

          {debugInfo && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Debug Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-1">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Path</span>
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-mono" title={debugInfo.path}>
                          {debugInfo.path}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            copyToClipboard(debugInfo.path)
                            toast.success('Copied to clipboard')
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {debugInfo.last_modified && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Last Modified</span>
                        <span className="text-xs font-mono">
                          {new Date(debugInfo.last_modified).toLocaleString()}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Size</span>
                      <span className="text-sm font-medium">{formatBytes(debugInfo.size)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tables</span>
                      <span className="text-sm font-medium">{debugInfo.table_count}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">CLI Command</span>
                      <span className="text-sm font-mono">{debugInfo.cli_command}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {debugInfo.stats && (
                      <>
                        {debugInfo.stats.sessions !== undefined && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Sessions</span>
                            <span className="text-sm font-medium">{debugInfo.stats.sessions}</span>
                          </div>
                        )}
                        {debugInfo.stats.approvals !== undefined && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Approvals</span>
                            <span className="text-sm font-medium">{debugInfo.stats.approvals}</span>
                          </div>
                        )}
                        {debugInfo.stats.events !== undefined && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Events</span>
                            <span className="text-sm font-medium">{debugInfo.stats.events}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
