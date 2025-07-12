import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { daemonClient } from '@/lib/daemon'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ThemeSelector'
import { SessionLauncher } from '@/components/SessionLauncher'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { useSessionLauncher, useSessionLauncherHotkeys } from '@/hooks/useSessionLauncher'
import { useStore } from '@/AppStore'
import { useSessionEventsWithNotifications } from '@/hooks/useSessionEventsWithNotifications'
import { Toaster } from 'sonner'
import { notificationService } from '@/services/NotificationService'
import { useZoom } from '@/contexts/ZoomContext'
import '@/App.css'

export function Layout() {
  const [status, setStatus] = useState('')
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  // Session launcher state
  const { isOpen, close } = useSessionLauncher()
  const { handleKeyDown } = useSessionLauncherHotkeys()

  // Zoom functionality
  const { increaseZoom, decreaseZoom, resetZoom } = useZoom()

  // Set up real-time subscriptions with notification handling
  useSessionEventsWithNotifications(connected)

  // Connect to daemon on mount
  useEffect(() => {
    connectToDaemon()
  }, [])

  // Load sessions initially when connected
  useEffect(() => {
    if (connected) {
      loadSessions()
    }
  }, [connected])

  // Refresh sessions on window focus
  useEffect(() => {
    const handleFocus = () => {
      if (connected) {
        loadSessions()
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [connected])

  // Refresh sessions when a new session is created
  useEffect(() => {
    const handleSessionCreated = () => {
      if (connected) {
        loadSessions()
      }
    }

    window.addEventListener('session-created', handleSessionCreated)
    return () => window.removeEventListener('session-created', handleSessionCreated)
  }, [connected])

  // Global hotkey handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Handle zoom shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          increaseZoom()
          return
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          decreaseZoom()
          return
        } else if (e.key === '0') {
          e.preventDefault()
          resetZoom()
          return
        }
      }

      // Handle other shortcuts
      handleKeyDown(e)
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleKeyDown, increaseZoom, decreaseZoom, resetZoom])

  const connectToDaemon = async () => {
    try {
      setStatus('Connecting to daemon...')
      await daemonClient.connect()
      setStatus('Connected!')
      setConnected(true)

      // Check health
      const health = await daemonClient.health()
      setStatus(`Connected! Daemon @ ${health.version}`)

      // Load sessions
      await loadSessions()
    } catch (error) {
      setStatus(`Failed to connect: ${error}`)
      setConnected(false)
    }
  }

  const loadSessions = async () => {
    try {
      await useStore.getState().refreshSessions()
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const handleApproval = async (approval: any, approved: boolean) => {
    try {
      if (approval.type === 'function_call' && approval.function_call) {
        if (approved) {
          await daemonClient.approveFunctionCall(approval.function_call.call_id, 'Approved via UI')
        } else {
          await daemonClient.denyFunctionCall(approval.function_call.call_id, 'Denied via UI')
        }
      } else if (approval.type === 'human_contact' && approval.human_contact) {
        const response = prompt('Enter your response:')
        if (response) {
          await daemonClient.respondToHumanContact(approval.human_contact.call_id, response)
        }
      }

      // Refresh approvals
      if (activeSessionId) {
        const response = await daemonClient.fetchApprovals(activeSessionId)
        setApprovals(response.approvals)
      }
    } catch (error) {
      notificationService.notifyError(error, 'Failed to handle approval')
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border"></div>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 overflow-hidden">
        {connected && (
          <>
            <Breadcrumbs />
            <div className="flex-1 overflow-y-auto">
              <Outlet />
            </div>

            {approvals.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h2 className="font-mono uppercase tracking-wider text-accent mb-4">
                  Pending Approvals ({approvals.length})
                </h2>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {approvals.map((approval, index) => (
                    <div
                      key={index}
                      className="p-4 border border-border bg-secondary/20 font-mono text-sm"
                    >
                      <div className="mb-2">
                        <span className="text-accent">Type:</span> {approval.type}
                      </div>
                      {approval.function_call && (
                        <>
                          <div className="mb-2">
                            <span className="text-accent">Function:</span>{' '}
                            {approval.function_call.spec.fn}
                          </div>
                          <div className="mb-3">
                            <span className="text-accent">Args:</span>{' '}
                            {JSON.stringify(approval.function_call.spec.kwargs)}
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={() => handleApproval(approval, true)} size="sm">
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleApproval(approval, false)}
                              variant="destructive"
                              size="sm"
                            >
                              Deny
                            </Button>
                          </div>
                        </>
                      )}
                      {approval.human_contact && (
                        <>
                          <div className="mb-3">
                            <span className="text-accent">Message:</span>{' '}
                            {approval.human_contact.spec.msg}
                          </div>
                          <Button onClick={() => handleApproval(approval, true)} size="sm">
                            Respond
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Status bar */}
      <div className="flex justify-between items-center px-3 py-1.5 border-t border-border bg-secondary/30">
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            humanlayer
          </div>
          {!connected && (
            <Button onClick={connectToDaemon} variant="ghost" size="sm">
              Retry Connection
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ThemeSelector />
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="uppercase tracking-wider">{status}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-[--terminal-success]' : 'bg-[--terminal-error]'
              }`}
            ></span>
          </div>
        </div>
      </div>

      {/* Session Launcher */}
      <SessionLauncher isOpen={isOpen} onClose={close} />

      {/* Notifications */}
      <Toaster position="bottom-right" richColors />
    </div>
  )
}
