import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { daemonClient, SessionStatus } from '@/lib/daemon'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ThemeSelector'
import { SessionLauncher } from '@/components/SessionLauncher'
import { HotkeyPanel } from '@/components/HotkeyPanel'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { useSessionLauncher, useSessionLauncherHotkeys } from '@/hooks/useSessionLauncher'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { useStore } from '@/AppStore'
import { useSessionSubscriptions } from '@/hooks/useSubscriptions'
import { Toaster } from 'sonner'
import { notificationService } from '@/services/NotificationService'
import { useTheme } from '@/contexts/ThemeContext'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageCircle } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@/App.css'

export function Layout() {
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)
  const { setTheme } = useTheme()

  // Use the daemon connection hook for all connection management
  const { connected, connecting, version, connect } = useDaemonConnection()

  // Hotkey panel state from store
  const { isHotkeyPanelOpen, setHotkeyPanelOpen } = useStore()

  // Session launcher state
  const { isOpen, close } = useSessionLauncher()
  const { handleKeyDown } = useSessionLauncherHotkeys()

  // Secret hotkey for launch theme
  useHotkeys('mod+shift+y', () => {
    setTheme('launch')
  })

  // Get store actions
  const updateSessionStatus = useStore(state => state.updateSessionStatus)
  const refreshActiveSessionConversation = useStore(state => state.refreshActiveSessionConversation)

  // Set up single SSE subscription for all events
  useSessionSubscriptions(connected, {
    onSessionStatusChanged: async data => {
      console.log('useSessionSubscriptions.onSessionStatusChanged', data)
      const { session_id, new_status } = data
      updateSessionStatus(session_id, new_status as SessionStatus)
      await refreshActiveSessionConversation(session_id)
    },
    onNewApproval: async data => {
      console.log('useSessionSubscriptions.onNewApproval', data)
      updateSessionStatus(data.session_id, SessionStatus.WaitingInput)
      await refreshActiveSessionConversation(data.session_id)
    },
    onApprovalResolved: async data => {
      console.log('useSessionSubscriptions.onApprovalResolved', data)
      updateSessionStatus(data.session_id, SessionStatus.Running)
      await refreshActiveSessionConversation(data.session_id)
    },
  })

  // Global hotkey for toggling hotkey panel
  useHotkeys(
    '?',
    () => {
      setHotkeyPanelOpen(!isHotkeyPanelOpen)
    },
    {
      useKey: true,
      preventDefault: true,
    },
  )

  // Global hotkey for feedback
  useHotkeys('mod+shift+f', async () => {
    try {
      await openUrl(
        'https://github.com/humanlayer/humanlayer/issues/new?title=Feedback%20on%20CodeLayer&body=%23%23%23%20Problem%20to%20solve%20%2F%20Expected%20Behavior%0A%0A%0A%23%23%23%20Proposed%20solution',
      )
    } catch (error) {
      console.error('Failed to open feedback URL:', error)
    }
  })

  // Load sessions when connected
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
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const loadSessions = async () => {
    try {
      await useStore.getState().refreshSessions()
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const handleApproval = async (approval: any, approved: boolean) => {
    try {
      // Handle new approval format directly
      if (!approval || !approval.id) {
        console.error('Invalid approval data:', approval)
        return
      }

      const approvalId = approval.id

      if (approved) {
        await daemonClient.approveFunctionCall(approvalId, 'Approved via UI')
      } else {
        await daemonClient.denyFunctionCall(approvalId, 'Denied via UI')
      }

      // Refresh approvals
      if (activeSessionId) {
        const response = await daemonClient.fetchApprovals(activeSessionId)
        setApprovals(response)
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
            <div className="flex-1 overflow-y-auto" data-main-scroll-container>
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
                        <span className="text-accent">Tool:</span> {approval.toolName}
                      </div>
                      <div className="mb-2">
                        <span className="text-accent">Session:</span> {approval.sessionId.slice(0, 8)}
                      </div>
                      <div className="mb-3">
                        <span className="text-accent">Input:</span> {JSON.stringify(approval.toolInput)}
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
          {!connected && !connecting && (
            <Button onClick={connect} variant="ghost" size="sm">
              Retry Connection
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/humanlayer/humanlayer/issues/new?title=Feedback%20on%20CodeLayer&body=%23%23%23%20Problem%20to%20solve%20%2F%20Expected%20Behavior%0A%0A%0A%23%23%23%20Proposed%20solution"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors"
              >
                <MessageCircle className="w-3 h-3" />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p>Submit feedback (⌘⇧F)</p>
            </TooltipContent>
          </Tooltip>
          <ThemeSelector />
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="uppercase tracking-wider">
              {connecting && 'CONNECTING...'}
              {connected && version && `CONNECTED @ ${version}`}
              {!connecting && !connected && 'DISCONNECTED'}
            </span>
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

      {/* Hotkey Panel */}
      <HotkeyPanel open={isHotkeyPanelOpen} onOpenChange={setHotkeyPanelOpen} />

      {/* Notifications */}
      <Toaster position="bottom-right" richColors />
    </div>
  )
}
