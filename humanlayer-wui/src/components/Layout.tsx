import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { register } from '@tauri-apps/plugin-global-shortcut'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { windowStateService } from '@/services/WindowStateService'
import {
  ApprovalResolvedEventData,
  ApprovalStatus,
  daemonClient,
  NewApprovalEventData,
  SessionSettingsChangedEventData,
  SessionSettingsChangeReason,
  SessionStatus,
  SessionStatusChangedEventData,
  ViewMode,
} from '@/lib/daemon'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ThemeSelector'
import { HotkeyPanel } from '@/components/HotkeyPanel'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { SettingsDialog } from '@/components/SettingsDialog'
import { OptInTelemetryModal } from '@/components/OptInTelemetryModal'
import { SessionLauncher } from '@/components/SessionLauncher'
import { useSessionLauncher, useSessionLauncherHotkeys } from '@/hooks/useSessionLauncher'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { useStore } from '@/AppStore'
import { useSessionSubscriptions } from '@/hooks/useSubscriptions'
import { notificationService, type NotificationOptions } from '@/services/NotificationService'
import { useTheme } from '@/contexts/ThemeContext'
import { formatMcpToolName, getSessionNotificationText } from '@/utils/formatting'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MessageCircle, Bug, HelpCircle, Settings, AlertCircle, RefreshCw } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { DebugPanel } from '@/components/DebugPanel'
import { notifyLogLocation } from '@/lib/log-notification'
import '@/App.css'
import { logger } from '@/lib/logging'
import { DangerousSkipPermissionsMonitor } from '@/components/DangerousSkipPermissionsMonitor'
import { KeyboardShortcut } from '@/components/HotkeyPanel'
import { DvdScreensaver } from '@/components/DvdScreensaver'
import { TestErrorTrigger } from '@/components/TestErrorTrigger'
import { CodeLayerToaster } from '@/components/internal/CodeLayerToaster'
import { useDebugStore } from '@/stores/useDebugStore'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export function Layout() {
  const [approvals, setApprovals] = useState<any[]>([])
  const [activeSessionId] = useState<string | null>(null)
  const { setTheme } = useTheme()
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false)
  const [hasShownUnhealthyDialog, setHasShownUnhealthyDialog] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const isSettingsDialogOpen = useStore(state => state.isSettingsDialogOpen)
  const setSettingsDialogOpen = useStore(state => state.setSettingsDialogOpen)
  const clearActiveSessionDetail = useStore(state => state.clearActiveSessionDetail)
  const [showTelemetryModal, setShowTelemetryModal] = useState(false)

  // Use the daemon connection hook for all connection management
  const { connected, connecting, version, healthStatus, connect, checkHealth } = useDaemonConnection()

  // Hotkey panel state from store
  const { isHotkeyPanelOpen, setHotkeyPanelOpen } = useStore()

  // Session launcher state
  const { isOpen, close } = useSessionLauncher()
  // Initialize hotkeys (they're now handled via useHotkeys in the hook)
  useSessionLauncherHotkeys()

  // Debug store state
  const showDevUrl = useDebugStore(state => state.showDevUrl)

  /*
    react-hotkeys-hook had some trouble doing adding this shortcut,
    I suspect because it overlaps typical browser behavior, so for now just using
    a global event listener
  */
  useEffect(() => {
    const backForwardHandler = (e: KeyboardEvent) => {
      if (e.metaKey && e.code === 'BracketLeft') {
        e.preventDefault()
        navigate(-1)
      } else if (e.metaKey && e.code === 'BracketRight') {
        e.preventDefault()
        navigate(1)
      }
    }

    window.addEventListener('keydown', backForwardHandler)
    return () => window.removeEventListener('keydown', backForwardHandler)
  }, [])

  // Initialize window state service for main window only
  useEffect(() => {
    // Only initialize for main window, not quick-launcher
    if (window.location.hash !== '#/quick-launcher') {
      windowStateService.initialize()
    }

    return () => {
      windowStateService.destroy()
    }
  }, [])

  // Secret hotkey for launch theme
  useHotkeys(
    'meta+shift+y, ctrl+shift+y',
    () => {
      setTheme('launch')
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
    },
  )

  // Settings dialog hotkey
  // TODO: We should bump this to "cmd+," later on
  // There's some pain associated with doing this with MenuBuilder in Tauri, so saving for later
  useHotkeys(
    'meta+shift+s, ctrl+shift+s',
    () => {
      setSettingsDialogOpen(!isSettingsDialogOpen)
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      enableOnFormTags: true,
    },
  )

  // Jump to most recent approval hotkey
  useHotkeys(
    'meta+shift+j, ctrl+shift+j',
    async () => {
      try {
        // Get all visible toasts
        // @ts-ignore - getToasts might not be in type definitions
        const visibleToasts = toast.getToasts ? toast.getToasts() : []
        const approvalToasts = visibleToasts.filter(
          t => typeof t.id === 'string' && t.id.startsWith('approval_required:'),
        )

        let targetApproval: { id: string; sessionId: string } | null = null

        // If there are visible approval toasts, jump to the most recent one
        if (approvalToasts.length > 0) {
          // Toast IDs format: approval_required:${approvalId}
          // Pick the last toast in the array (most recent)
          const mostRecentToast = approvalToasts[approvalToasts.length - 1]
          const toastIdParts = (mostRecentToast.id as string).split(':')
          const approvalId = toastIdParts[1]

          // Find which session this approval belongs to
          const sessions = await daemonClient.listSessions()
          for (const session of sessions) {
            try {
              const conversation = await daemonClient.getConversation({ session_id: session.id })
              const approval = conversation.find(
                event =>
                  event.approvalStatus === ApprovalStatus.Pending && event.approvalId === approvalId,
              )
              if (approval) {
                targetApproval = { id: approvalId, sessionId: session.id }
                break
              }
            } catch {
              // Silent failure for sessions we can't fetch
            }
          }
        } else {
          // No visible toasts, fall back to fetching all approvals from daemon
          const sessions = await daemonClient.listSessions()

          // Collect all pending approvals from all sessions
          const pendingApprovals: Array<{
            id: string
            sessionId: string
            createdAt: string
          }> = []

          for (const session of sessions) {
            try {
              const conversation = await daemonClient.getConversation({ session_id: session.id })
              const sessionPendingApprovals = conversation
                .filter(event => event.approvalStatus === ApprovalStatus.Pending && event.approvalId)
                .map(event => ({
                  id: event.approvalId!,
                  sessionId: session.id,
                  createdAt: event.createdAt ? event.createdAt.toISOString() : new Date().toISOString(),
                }))

              pendingApprovals.push(...sessionPendingApprovals)
            } catch {
              // Silent failure for sessions we can't fetch
            }
          }

          if (pendingApprovals.length > 0) {
            // Sort by createdAt timestamp (newest first)
            const sortedApprovals = [...pendingApprovals].sort((a, b) => {
              const timeA = new Date(a.createdAt).getTime()
              const timeB = new Date(b.createdAt).getTime()
              return timeB - timeA // Descending order (newest first)
            })
            targetApproval = sortedApprovals[0]
          }
        }

        if (!targetApproval) {
          toast.error('No pending approvals')
          return
        }

        // Flash the button to provide visual feedback
        const toastId = `approval_required:${targetApproval.id}`

        if (visibleToasts.some(t => t.id === toastId)) {
          // Find the button directly using the toastId data attribute
          // Use CSS.escape to safely handle special characters in the selector
          const escapedToastId = CSS.escape(toastId)
          const buttonElement = document.querySelector(
            `[data-toast-id="${escapedToastId}"][data-button][data-action]`,
          ) as HTMLElement

          if (buttonElement) {
            // Apply flash effect using the button's border color (accent color)
            buttonElement.classList.add('!bg-[var(--terminal-accent)]', '!text-background')

            // Also ensure text contrast for all child elements
            const childElements = buttonElement.querySelectorAll('*')
            childElements.forEach(child => {
              ;(child as HTMLElement).classList.add('!text-background')
            })

            // Remove flash after 100ms
            setTimeout(() => {
              // Remove only the flash classes, preserving any other dynamic classes
              buttonElement.classList.remove('!bg-[var(--terminal-accent)]', '!text-background')
              childElements.forEach(child => {
                ;(child as HTMLElement).classList.remove('!text-background')
              })

              // Wait another 100ms before dismissing toast
              setTimeout(() => {
                toast.dismiss(toastId)
                // Clear stale session detail before navigating to ensure clean state
                clearActiveSessionDetail()
                // Navigate to the session with approval parameter
                navigate(`/sessions/${targetApproval.sessionId}?approval=${targetApproval.id}`)
              }, 100)
            }, 100)

            return // Early return to prevent fallback behavior
          }

          // Fallback: if button not found, just dismiss immediately and navigate
          toast.dismiss(toastId)
          // Clear stale session detail before navigating to ensure clean state
          clearActiveSessionDetail()
          navigate(`/sessions/${targetApproval.sessionId}?approval=${targetApproval.id}`)
        } else {
          // Navigate immediately since there's no toast
          // Clear stale session detail before navigating to ensure clean state
          clearActiveSessionDetail()
          navigate(`/sessions/${targetApproval.sessionId}?approval=${targetApproval.id}`)
        }
      } catch (error) {
        console.error('Failed to jump to approval:', error)
        toast.error('Failed to fetch approvals')
      }
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      enableOnFormTags: false,
      preventDefault: true,
    },
    [navigate],
  )

  // Get store actions
  const updateSession = useStore(state => state.updateSession)
  const updateSessionStatus = useStore(state => state.updateSessionStatus)
  const fetchUserSettings = useStore(state => state.fetchUserSettings)
  const userSettings = useStore(state => state.userSettings)

  // Fetch user settings when connected
  useEffect(() => {
    if (connected) {
      fetchUserSettings()
    }
  }, [connected, fetchUserSettings])

  // Auto-open settings on first unhealthy detection
  useEffect(() => {
    if (connected && healthStatus === 'degraded' && !hasShownUnhealthyDialog) {
      setSettingsDialogOpen(true)
      setHasShownUnhealthyDialog(true)
    }
  }, [connected, healthStatus, hasShownUnhealthyDialog, setSettingsDialogOpen])

  // Show telemetry modal on first run
  useEffect(() => {
    if (connected && userSettings !== null) {
      const OPT_IN_KEY = 'telemetry-opt-in-seen'
      // Show modal on first connection if user hasn't chosen yet
      const hasSeenDialog = localStorage.getItem(OPT_IN_KEY) === 'true'
      if (
        !hasSeenDialog &&
        (userSettings.optInTelemetry === undefined || userSettings.optInTelemetry === false)
      ) {
        setShowTelemetryModal(true)
        localStorage.setItem(OPT_IN_KEY, 'true')
      }
    }
  }, [connected, userSettings])
  const refreshActiveSessionConversation = useStore(state => state.refreshActiveSessionConversation)
  const clearNotificationsForSession = useStore(state => state.clearNotificationsForSession)
  const wasRecentlyNavigatedFrom = useStore(state => state.wasRecentlyNavigatedFrom)
  const addNotifiedItem = useStore(state => state.addNotifiedItem)
  const isItemNotified = useStore(state => state.isItemNotified)
  const addRecentResolvedApprovalToCache = useStore(state => state.addRecentResolvedApprovalToCache)
  const isRecentResolvedApproval = useStore(state => state.isRecentResolvedApproval)
  const setActiveSessionDetail = useStore(state => state.setActiveSessionDetail)
  const updateActiveSessionDetail = useStore(state => state.updateActiveSessionDetail)

  // Set up single SSE subscription for all events
  useSessionSubscriptions(connected, {
    onSessionStatusChanged: async (data: SessionStatusChangedEventData) => {
      logger.log('useSessionSubscriptions.onSessionStatusChanged', Date.now(), data)
      const { session_id, new_status: nextStatus } = data
      const targetSession = useStore.getState().sessions.find(s => s.id === session_id)
      const previousStatus = targetSession?.status
      const sessionResponse = await daemonClient.getSessionState(data.session_id)
      const session = sessionResponse.session

      // Always update the session in the sessions list
      // Use updateSession (not updateSessionOptimistic) since this is data FROM the server
      useStore.getState().updateSession(session_id, session)

      // Update active session detail if this is the currently viewed session
      const activeSessionId = useStore.getState().activeSessionDetail?.session?.id
      if (activeSessionId === session_id) {
        updateActiveSessionDetail(session)
      }

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
          const sessionText = getSessionNotificationText(session)

          let notificationOptions: NotificationOptions = {
            type: 'session_completed',
            title: `Session Completed (${data.session_id.slice(0, 8)})`,
            body: `Completed: ${sessionText}`,
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
            notificationOptions.body = session.errorMessage || `Failed: ${sessionText}`
            notificationOptions.priority = 'high'
          }

          await notificationService.notify(notificationOptions)
        } catch (error) {
          logger.error('Failed to show completion notification:', error)
        }
      }

      // Update the full session data, not just the status
      // This ensures token counts and other fields are preserved
      if (session) {
        updateSession(session_id, {
          ...session,
          status: nextStatus,
        })
      } else {
        // Fallback to just updating status if we couldn't fetch the session
        updateSessionStatus(session_id, nextStatus)
      }

      await refreshActiveSessionConversation(session_id)
    },
    onNewApproval: async (data: NewApprovalEventData) => {
      logger.log('useSessionSubscriptions.onNewApproval', Date.now(), data)
      const { approval_id: approvalId, session_id: sessionId, tool_name: toolName } = data

      if (!approvalId || !sessionId) {
        logger.error('Invalid approval event data:', data)
        return
      }

      const conversation = await daemonClient.getConversation({ session_id: sessionId })
      const approval = conversation.find(
        event => event.approvalStatus === ApprovalStatus.Pending && event.approvalId === approvalId,
      )

      if (!approval) {
        return
      }

      const toolInputJson = approval.toolInputJson

      const notificationId = `approval_required:${sessionId}:${approvalId}`
      if (isItemNotified(notificationId)) {
        return
      }

      // Wait a brief moment to see if an approval_resolved event follows immediately
      // This handles auto-approved cases where both events fire in quick succession
      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if this approval was already resolved (auto-approved)
      if (isRecentResolvedApproval(approvalId)) {
        logger.debug('Skipping notification for auto-approved item', { sessionId, approvalId })
        return
      }

      // Format tool name if it's an MCP tool
      const displayToolName = toolName.startsWith('mcp__') ? formatMcpToolName(toolName) : toolName

      try {
        const sessionState = await daemonClient.getSessionState(sessionId)
        const model = sessionState.session?.model || 'AI Agent'
        const sessionTitle = sessionState.session?.title || sessionState.session?.summary

        await notificationService.notifyApprovalRequired(
          sessionId,
          approvalId,
          displayToolName,
          toolInputJson || '',
          model,
          sessionTitle,
        )
        addNotifiedItem(notificationId)
      } catch (error) {
        logger.error(`Failed to get session state for ${sessionId}:`, error)
        // Still show notification with limited info
        await notificationService.notifyApprovalRequired(
          sessionId,
          approvalId,
          displayToolName,
          toolInputJson || '',
          'AI Agent',
          undefined, // No session title available
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
      notificationService.clearNotificationByApprovalId(data.approval_id)
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

      // Get current session to compare values
      const currentSession = useStore.getState().sessions.find(s => s.id === data.session_id)

      const updates: Record<string, any> = {}
      let hasActualChanges = false

      if (data.auto_accept_edits !== undefined) {
        // Only mark as changed if the value is actually different
        if (currentSession && currentSession.autoAcceptEdits !== data.auto_accept_edits) {
          hasActualChanges = true
        }
        updates.autoAcceptEdits = data.auto_accept_edits
      }

      if (data.dangerously_skip_permissions !== undefined) {
        // Only mark as changed if the value is actually different
        if (
          currentSession &&
          currentSession.dangerouslySkipPermissions !== data.dangerously_skip_permissions
        ) {
          hasActualChanges = true
        }
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

      // Only show notification if settings actually changed
      if (notificationService && hasActualChanges) {
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

  // Root hotkey for toggling hotkey panel
  useHotkeys(
    '?',
    () => {
      setHotkeyPanelOpen(!isHotkeyPanelOpen)
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      useKey: true,
      preventDefault: true,
    },
  )

  // Navigation shortcuts - 'gs' for sessions (normal view), 'ge' for archived
  // Note: Root scope hotkeys are now automatically disabled when modals open

  // G+S - Go to sessions (normal view)
  useHotkeys(
    'g>s',
    e => {
      e.stopPropagation()
      // Navigate to sessions (normal view)
      if (useStore.getState().getViewMode() !== ViewMode.Normal) {
        useStore.getState().setViewMode(ViewMode.Normal)
      }
      navigate('/')
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      preventDefault: true,
      enableOnFormTags: false,
    },
  )

  // G+E - Go to archived sessions
  useHotkeys(
    'g>e',
    e => {
      e.stopPropagation()
      // Navigate to archived sessions
      if (useStore.getState().getViewMode() !== ViewMode.Archived) {
        useStore.getState().setViewMode(ViewMode.Archived)
      }
      navigate('/')
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      preventDefault: true,
      enableOnFormTags: false,
    },
  )

  // G+I - Go to inbox/sessions (alias for g>s)
  useHotkeys(
    'g>i',
    e => {
      e.stopPropagation()
      // Navigate to sessions (normal view)
      if (useStore.getState().getViewMode() !== ViewMode.Normal) {
        useStore.getState().setViewMode(ViewMode.Normal)
      }
      navigate('/')
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      preventDefault: true,
      enableOnFormTags: false,
    },
  )

  // G+D - Go to drafts
  useHotkeys(
    'g>d',
    e => {
      e.stopPropagation()
      // Navigate to drafts view
      if (useStore.getState().getViewMode() !== ViewMode.Drafts) {
        useStore.getState().setViewMode(ViewMode.Drafts)
      }
      navigate('/')
    },
    {
      scopes: [HOTKEY_SCOPES.ROOT],
      preventDefault: true,
      enableOnFormTags: false,
    },
  )

  // Global hotkey for feedback
  // Don't specify scopes to make it work globally (defaults to wildcard '*')
  useHotkeys(
    'meta+shift+f, ctrl+shift+f',
    async () => {
      try {
        await openUrl('https://github.com/humanlayer/humanlayer/issues/new/choose')
      } catch (error) {
        logger.error('Failed to open feedback URL:', error)
      }
    },
    {
      // No scopes specified - works in wildcard scope
      enabled: true,
      preventDefault: true,
    },
  )

  // Prevent escape key from exiting full screen
  // Might be worth guarding this specifically in macOS
  // down-the-road
  useHotkeys(
    'escape',
    () => {
      // console.log('escape!', ev);
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  )

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

  // Global hotkey handler is now handled via useHotkeys in useSessionLauncherHotkeys

  // Notify about log location on startup (production only)
  useEffect(() => {
    if (!import.meta.env.DEV) {
      notifyLogLocation()
    }
  }, [])

  // Register global shortcut as backup (Rust is primary)
  useEffect(() => {
    register('CommandOrControl+Shift+H', async event => {
      if (event.state === 'Pressed') {
        await invoke('show_quick_launcher')
      }
    }).catch(error => {
      logger.debug('Global shortcut registration handled by Rust:', error)
    })
  }, [])

  // Listen for events from quick launcher window
  useEffect(() => {
    const handleSessionCreated = async (payload: { sessionId: string }) => {
      const { sessionId } = payload
      if (sessionId) {
        // Clear stale session detail before navigating to ensure clean state
        clearActiveSessionDetail()
        // Navigate to the new session silently
        navigate(`/sessions/${sessionId}`)

        // Do NOT focus the window - let it happen in background
        // User will switch to the app when they're ready
      }
    }

    // Set up the listener for cross-window communication
    let unlistenPromise: Promise<() => void> | null = null

    const setupListener = async () => {
      const unlisten = await listen('session-created', event => {
        handleSessionCreated(event.payload as { sessionId: string })
      })
      return unlisten
    }

    unlistenPromise = setupListener()

    return () => {
      if (unlistenPromise) {
        unlistenPromise.then(unlisten => unlisten())
      }
    }
  }, [navigate])

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
      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 overflow-hidden">
        {connected && (
          <>
            {location.pathname !== '/' && <Breadcrumbs />}
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
          {connected && healthStatus === 'degraded' && (
            <Button
              onClick={() => setSettingsDialogOpen(true)}
              variant="outline"
              size="sm"
              className="text-amber-500 border-amber-500"
            >
              <AlertCircle className="h-4 w-4 mr-2" />
              Unhealthy - Configure
            </Button>
          )}
          {!connected && !connecting && (
            <Button onClick={connect} variant="ghost" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {import.meta.env.DEV && showDevUrl && (
            <span className="text-xs text-muted-foreground">{window.location.href}</span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/humanlayer/humanlayer/issues/new/choose"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setHotkeyPanelOpen(true)}
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <HelpCircle className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="flex items-center gap-1">
                View all keyboard shortcuts <KeyboardShortcut keyString="?" />
              </p>
            </TooltipContent>
          </Tooltip>
          {import.meta.env.DEV && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsDebugPanelOpen(true)}
                  className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSettingsDialogOpen(true)}
                className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-mono border border-border bg-background text-foreground hover:bg-accent/10 transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <Settings className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex items-center gap-1">
                Settings <KeyboardShortcut keyString="⌘+⇧+S" />
              </div>
            </TooltipContent>
          </Tooltip>
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

      {/* Session Launcher Modal */}
      <SessionLauncher isOpen={isOpen} onClose={close} />

      {/* Hotkey Panel */}
      <HotkeyPanel open={isHotkeyPanelOpen} onOpenChange={setHotkeyPanelOpen} />

      {/* Notifications */}
      <CodeLayerToaster />

      {/* Debug Panel */}
      <DebugPanel open={isDebugPanelOpen} onOpenChange={setIsDebugPanelOpen} />

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        onConfigUpdate={checkHealth}
      />

      {/* Telemetry opt-in modal */}
      <OptInTelemetryModal open={showTelemetryModal} onOpenChange={setShowTelemetryModal} />

      {/* Global Dangerous Skip Permissions Monitor */}
      <DangerousSkipPermissionsMonitor />

      {/* DVD Screensaver */}
      <DvdScreensaver />

      {/* Test Error Trigger for Sentry testing */}
      <TestErrorTrigger />
    </div>
  )
}
