import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  ApprovalResolvedEventData,
  daemonClient,
  NewApprovalEventData,
  SessionSettingsChangedEventData,
  SessionSettingsChangeReason,
  SessionStatus,
  SessionStatusChangedEventData,
} from '@/lib/daemon'
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
import { notificationService, type NotificationOptions } from '@/services/NotificationService'
import { useTheme } from '@/contexts/ThemeContext'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageCircle, Bug } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { DebugPanel } from '@/components/DebugPanel'
import { notifyLogLocation } from '@/lib/log-notification'
import '@/App.css'
import { logger } from '@/lib/logging'
import { DangerousSkipPermissionsMonitor } from '@/components/DangerousSkipPermissionsMonitor'
import { KeyboardShortcut } from '@/components/HotkeyPanel'

export function Layout() {
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)
  const { setTheme } = useTheme()
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false)
  const location = useLocation()

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
  const updateSession = useStore(state => state.updateSession)
  const updateSessionStatus = useStore(state => state.updateSessionStatus)
  const refreshActiveSessionConversation = useStore(state => state.refreshActiveSessionConversation)
  const clearNotificationsForSession = useStore(state => state.clearNotificationsForSession)
  const wasRecentlyNavigatedFrom = useStore(state => state.wasRecentlyNavigatedFrom)
  const addNotifiedItem = useStore(state => state.addNotifiedItem)
  const isItemNotified = useStore(state => state.isItemNotified)
  const addRecentResolvedApprovalToCache = useStore(state => state.addRecentResolvedApprovalToCache)
  const isRecentResolvedApproval = useStore(state => state.isRecentResolvedApproval)
  const setActiveSessionDetail = useStore(state => state.setActiveSessionDetail)

  // Set up single SSE subscription for all events
  useSessionSubscriptions(connected, {
    onSessionStatusChanged: async (data: SessionStatusChangedEventData) => {
      logger.log('useSessionSubscriptions.onSessionStatusChanged', Date.now(), data)
      const { session_id, new_status: nextStatus } = data
      const targetSession = useStore.getState().sessions.find(s => s.id === session_id)
      const previousStatus = targetSession?.status
      const sessionResponse = await daemonClient.getSessionState(data.session_id)
      const session = sessionResponse.session

      if (!nextStatus) {
        logger.warn('useSessionSubscriptions.onSessionStatusChanged: nextStatus is undefined', data)
        return
      }

      // Clear notifications if session is no longer waiting_input
      if (nextStatus !== undefined && nextStatus !== SessionStatus.WaitingInput) {
        clearNotificationsForSession(session_id)
      }

      // Completed or Failed, but not in series
      if (
        (previousStatus !== SessionStatus.Completed && nextStatus === SessionStatus.Completed) ||
        (previousStatus !== SessionStatus.Failed && nextStatus === SessionStatus.Failed)
      ) {
        logger.log(
          `Session ${data.session_id} completed. Previous status: ${previousStatus}, checking navigation tracking...`,
        )

        if (wasRecentlyNavigatedFrom(data.session_id)) {
          logger.log(
            `Suppressing completion notification for recently navigated session ${data.session_id}`,
          )
          return
        }

        try {
          let notificationOptions: NotificationOptions = {
            type: 'session_completed',
            title: `Session Completed (${data.session_id.slice(0, 8)})`,
            body: `Completed: ${session.query}`,
            metadata: {
              sessionId: data.session_id,
              model: session.model,
            },
            // Don't make this sticky - let it auto-dismiss
            duration: undefined,
          }

          if (nextStatus === SessionStatus.Failed) {
            notificationOptions.type = 'session_failed'
            notificationOptions.title = `Session Failed (${data.session_id.slice(0, 8)})`
            notificationOptions.body = session.errorMessage || `Failed: ${session.query}`
            notificationOptions.priority = 'high'
          }

          await notificationService.notify(notificationOptions)
        } catch (error) {
          logger.error('Failed to show completion notification:', error)
        }
      }

      updateSessionStatus(session_id, nextStatus)

      await refreshActiveSessionConversation(session_id)
    },
    onNewApproval: async (data: NewApprovalEventData) => {
      logger.log('useSessionSubscriptions.onNewApproval', Date.now(), data)
      const { approval_id: approvalId, session_id: sessionId, tool_name: toolName } = data

      if (!approvalId || !sessionId) {
        logger.error('Invalid approval event data:', data)
        return
      }

      const notificationId = `approval_required:${sessionId}:${approvalId}`
      if (isItemNotified(notificationId)) {
        return
      }

      // Wait a brief moment to see if an approval_resolved event follows immediately
      // This handles auto-approved cases where both events fire in quick succession
      await new Promise(resolve => setTimeout(resolve, 100))

      // // Check if this approval was already resolved (auto-approved)
      if (isRecentResolvedApproval(approvalId)) {
        console.log('Skipping notification for auto-approved item', { sessionId, approvalId })
        return
      }

      try {
        const sessionState = await daemonClient.getSessionState(sessionId)
        const model = sessionState.session?.model || 'AI Agent'

        await notificationService.notifyApprovalRequired(
          sessionId,
          approvalId,
          `${toolName} approval required`,
          model,
        )
        addNotifiedItem(notificationId)
      } catch (error) {
        logger.error(`Failed to get session state for ${sessionId}:`, error)
        // Still show notification with limited info
        await notificationService.notifyApprovalRequired(
          sessionId,
          approvalId,
          `${toolName} approval required`,
          'AI Agent',
        )
        addNotifiedItem(notificationId)
      }

      updateSessionStatus(sessionId, SessionStatus.WaitingInput)
      await refreshActiveSessionConversation(sessionId)
    },
    onApprovalResolved: async (data: ApprovalResolvedEventData) => {
      logger.log('useSessionSubscriptions.onApprovalResolved', Date.now(), data)
      addRecentResolvedApprovalToCache(data.approval_id)
      updateSessionStatus(data.session_id, SessionStatus.Running)
      await refreshActiveSessionConversation(data.session_id)
    },
    // CODEREVIEW: Why did this previously exist? Sundeep wants to talk about this do not merge.
    onSessionSettingsChanged: async (data: SessionSettingsChangedEventData) => {
      logger.log('useSessionSubscriptions.onSessionSettingsChanged', data)

      // Check if this is an expiry event from the server
      if (
        data.reason === SessionSettingsChangeReason.EXPIRED &&
        data.dangerously_skip_permissions === false
      ) {
        logger.debug('Server disabled expired dangerous skip permissions', {
          sessionId: data.session_id,
          expiredAt: data.expired_at,
        })
      }

      const updates: Record<string, any> = {}

      if (data.auto_accept_edits !== undefined) {
        updates.autoAcceptEdits = data.auto_accept_edits
      }

      if (data.dangerously_skip_permissions !== undefined) {
        updates.dangerouslySkipPermissions = data.dangerously_skip_permissions

        // Calculate expiry time if timeout provided
        if (data.dangerously_skip_permissions && data.dangerously_skip_permissions_timeout_ms) {
          const expiresAt = new Date(Date.now() + data.dangerously_skip_permissions_timeout_ms)
          updates.dangerouslySkipPermissionsExpiresAt = expiresAt
        } else if (!data.dangerously_skip_permissions) {
          updates.dangerouslySkipPermissionsExpiresAt = undefined
        }
      }

      updateSession(data.session_id, updates)

      // Show notification
      if (notificationService) {
        const title = data.dangerously_skip_permissions
          ? 'Bypassing permissions enabled'
          : data.auto_accept_edits
            ? 'Auto-accept edits enabled'
            : 'Auto-accept disabled'

        notificationService.notify({
          type: 'settings_changed',
          title,
          body: data.dangerously_skip_permissions
            ? 'ALL tools will be automatically approved'
            : data.auto_accept_edits
              ? 'Edit, Write, and MultiEdit tools will be automatically approved'
              : 'All tools require manual approval',
          metadata: { sessionId: data.session_id },
        })
      }
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
      logger.error('Failed to open feedback URL:', error)
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

  // Notify about log location on startup (production only)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      notifyLogLocation()
    }
  }, [])

  useEffect(() => {
    if (location.state?.continuationSession) {
      const session = location.state.continuationSession.session
      const conversation = location.state.continuationConversation || []
      setActiveSessionDetail(session.id, session, conversation)
    }
  }, [location.state?.continuationSession])

  const loadSessions = async () => {
    try {
      await useStore.getState().refreshSessions()
    } catch (error) {
      logger.error('Failed to load sessions:', error)
    }
  }

  const handleApproval = async (approval: any, approved: boolean) => {
    try {
      // Handle new approval format directly
      if (!approval || !approval.id) {
        logger.error('Invalid approval data:', approval)
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
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-sm font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors"
              >
                <MessageCircle className="w-3 h-3" />
              </a>
            </TooltipTrigger>
            <TooltipContent>
              <p className="flex items-center gap-1">
                Submit feedback <KeyboardShortcut keyString="⌘+⇧+F" />
              </p>
            </TooltipContent>
          </Tooltip>
          {import.meta.env.DEV && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsDebugPanelOpen(true)}
                  className="px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors"
                >
                  <Bug className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Debug Panel (Dev Only)</p>
              </TooltipContent>
            </Tooltip>
          )}
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

      {/* Debug Panel */}
      <DebugPanel open={isDebugPanelOpen} onOpenChange={setIsDebugPanelOpen} />

      {/* Global Dangerous Skip Permissions Monitor */}
      <DangerousSkipPermissionsMonitor />
    </div>
  )
}
