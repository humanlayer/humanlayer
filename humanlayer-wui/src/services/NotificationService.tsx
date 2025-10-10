import { toast, type ExternalToast } from 'sonner'
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { formatError } from '@/utils/errors'
import { logger } from '@/lib/logging'
import { CodeLayerToastButtons } from '@/components/internal/CodeLayerToastButtons'
import React from 'react'

// Types for generic notification system
export type NotificationType =
  | 'approval_required'
  | 'session_completed'
  | 'session_failed'
  | 'session_started'
  | 'system_alert'
  | 'error'
  | 'settings_changed'

export interface NotificationAction {
  label: string | React.ReactNode
  onClick: () => void
}

export interface NotificationOptions {
  type: NotificationType
  title: string | React.ReactNode
  body: string | React.ReactNode
  metadata: {
    sessionId?: string
    approvalId?: string
    [key: string]: any
  }
  actions?: NotificationAction[]
  duration?: number | null
  priority?: 'low' | 'normal' | 'high'
  returnToastConfig?: boolean // If true, returns config instead of showing toast (default: false)
}

class NotificationService {
  private appFocused: boolean = false // Default to unfocused
  private focusHandler: (() => void) | null = null
  private blurHandler: (() => void) | null = null
  private unlistenFocus: (() => void) | null = null
  private unlistenBlur: (() => void) | null = null

  constructor() {
    logger.log('NotificationService: Constructor called')
    this.attachFocusListeners()
  }

  /**
   * Get the platform-specific modifier key symbol
   */
  private getModifierKey(): string {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    return isMac ? '⌘' : 'Ctrl'
  }

  private validateFocusState() {
    // Force a focus check using document visibility
    if (typeof document !== 'undefined') {
      this.appFocused = document.hasFocus()
    }
  }

  private async attachFocusListeners() {
    logger.log('NotificationService: Attaching focus listeners')

    // Check initial focus state synchronously
    this.validateFocusState()

    // Clean up any existing listeners first
    await this.detachFocusListeners()

    try {
      // Try Tauri window events first
      const appWindow = getCurrentWindow()

      // Listen for focus events
      this.unlistenFocus = await appWindow.onFocusChanged(event => {
        logger.log('Tauri window focus changed:', event)
        this.appFocused = event.payload
      })

      // Also use standard window events as fallback
      this.focusHandler = () => {
        logger.log('window focused (standard event)')
        this.appFocused = true
      }

      this.blurHandler = () => {
        logger.log('window blurred (standard event)')
        this.appFocused = false
      }

      window.addEventListener('focus', this.focusHandler)
      window.addEventListener('blur', this.blurHandler)

      logger.log('NotificationService: Focus listeners attached')
    } catch (error) {
      logger.error('Failed to attach Tauri focus listeners, using standard events only:', error)

      // Fallback to standard events only
      this.focusHandler = () => {
        logger.log('window focused')
        this.appFocused = true
      }

      this.blurHandler = () => {
        logger.log('window blurred')
        this.appFocused = false
      }

      window.addEventListener('focus', this.focusHandler)
      window.addEventListener('blur', this.blurHandler)
    }
  }

  private async detachFocusListeners() {
    logger.log('NotificationService: Detaching focus listeners', {
      hasFocusHandler: !!this.focusHandler,
      hasBlurHandler: !!this.blurHandler,
      hasUnlistenFocus: !!this.unlistenFocus,
    })

    // Remove Tauri listeners
    if (this.unlistenFocus) {
      this.unlistenFocus()
      this.unlistenFocus = null
    }

    if (this.unlistenBlur) {
      this.unlistenBlur()
      this.unlistenBlur = null
    }

    // Remove standard listeners
    if (this.focusHandler) {
      window.removeEventListener('focus', this.focusHandler)
      this.focusHandler = null
    }

    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler)
      this.blurHandler = null
    }
  }

  /**
   * Clean up resources (useful for hot module replacement)
   */
  cleanup() {
    logger.log('NotificationService: Cleanup called')
    this.detachFocusListeners()
  }

  /**
   * Generate a unique notification ID based on type and metadata
   */
  generateNotificationId(type: NotificationType, metadata: Record<string, any>): string {
    const parts: string[] = [type]

    // Add relevant metadata to create unique ID
    if (metadata.sessionId) parts.push(metadata.sessionId)
    if (metadata.approvalId) parts.push(metadata.approvalId)

    // Add any other unique identifiers from metadata
    Object.entries(metadata).forEach(([key, value]) => {
      if (key !== 'sessionId' && key !== 'approvalId' && value) {
        parts.push(String(value))
      }
    })

    return parts.join(':')
  }

  /**
   * Check if user is currently viewing a specific session
   */
  private isViewingSession(sessionId: string): boolean {
    // Get current path from hash
    const currentHash = window.location.hash
    const sessionDetailPattern = /#\/sessions\/([^/]+)/
    const match = currentHash.match(sessionDetailPattern)

    if (match && match[1] === sessionId) {
      return true
    }

    return false
  }

  /**
   * Main entry point for notifications
   */
  async notify(options: NotificationOptions): Promise<
    | string
    | null
    | {
        title: string | React.ReactNode
        options: ExternalToast
        type: 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading'
      }
  > {
    this.validateFocusState() // Ensure focus state is current

    // Generate unique ID for this notification
    const notificationId = this.generateNotificationId(options.type, options.metadata)

    const isViewingSession = options.metadata.sessionId
      ? this.isViewingSession(options.metadata.sessionId)
      : false

    // If returnToastConfig is true, just return the config without showing anything
    if (options.returnToastConfig) {
      return this.buildToastConfig(options)
    }

    logger.log('NotificationService.notify:', {
      appFocused: this.appFocused,
      notificationType: options.type,
      sessionId: options.metadata.sessionId,
      isViewingSession,
    })

    // If app is blurred, always show OS notification
    if (!this.appFocused) {
      await this.showOSNotification(options)
    }
    // If app is focused but user is viewing the session, skip in-app notification
    else if (isViewingSession) {
      logger.log(`Skipping in-app notification: User is viewing session ${options.metadata.sessionId}`)
      return null
    }
    // Otherwise show in-app notification
    else {
      this.showInAppNotification(options)
    }

    return notificationId
  }

  /**
   * Build toast configuration without showing it
   */
  private buildToastConfig(options: NotificationOptions): {
    title: string | React.ReactNode
    options: ExternalToast
    type: 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading'
  } {
    const toastOptions: ExternalToast = {
      closeButton: true, // Always show close button for better UX
      description: options.body,
      duration: options.duration ?? 5000, // Default 5 seconds if undefined
      position: 'top-right', // Position toast at top right corner
    }

    // control notification id when showing an approval (may expand later)
    if (options.type === 'approval_required') {
      toastOptions.id = `${options.type}:${options.metadata.approvalId}`
    }

    // Add primary action if provided using CodeLayerToastButtons
    if (options.actions && options.actions.length > 0) {
      const primaryAction = options.actions[0]
      // Determine variant based on notification type
      const variant =
        options.type === 'error' || options.type === 'session_failed'
          ? 'error'
          : options.type === 'session_completed'
            ? 'success'
            : 'default'

      toastOptions.action = React.createElement(CodeLayerToastButtons, {
        action: {
          label: primaryAction.label,
          onClick: primaryAction.onClick,
        },
        variant,
        toastId: typeof toastOptions.id === 'string' ? toastOptions.id : undefined,
      })
    }

    // Determine toast type
    let toastType: 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading' = 'default'
    switch (options.type) {
      case 'session_failed':
      case 'error':
        toastType = 'error'
        break
      case 'session_completed':
        toastType = 'success'
        break
      default:
        toastType = 'default'
    }

    return {
      title: options.title,
      options: toastOptions,
      type: toastType,
    }
  }

  /**
   * Show in-app notification using Sonner
   */
  private showInAppNotification(options: NotificationOptions) {
    const config = this.buildToastConfig(options)

    // Show toast based on type
    switch (config.type) {
      case 'error':
        toast.error(config.title, config.options)
        break
      case 'success':
        toast.success(config.title, config.options)
        break
      default:
        toast(config.title, config.options)
    }
  }

  /**
   * Show OS-level notification using Tauri plugin
   */
  private async showOSNotification(options: NotificationOptions) {
    logger.log('NotificationService.showOSNotification called:', options.title)
    try {
      // Check if we have permission
      let permissionGranted = await isPermissionGranted()
      logger.log('OS notification permission granted:', permissionGranted)

      // Request permission if not granted
      if (!permissionGranted) {
        const permission = await requestPermission()
        permissionGranted = permission === 'granted'
      }

      if (!permissionGranted) {
        logger.warn('Notification permission not granted, falling back to in-app notification')
        this.showInAppNotification(options)
        return
      }

      // Send the notification
      // Convert React nodes to strings for OS notifications
      const titleString = typeof options.title === 'string' ? options.title : 'Notification'
      const bodyString = typeof options.body === 'string' ? options.body : ''

      await sendNotification({
        title: titleString,
        body: bodyString,
        // We can't directly handle clicks on OS notifications to navigate,
        // but at least the notification will bring attention to the app
      })
    } catch (error) {
      logger.error('Failed to show OS notification:', error)
      // Fallback to in-app notification
      this.showInAppNotification(options)
    }
  }

  /**
   * Convenience method for error notifications
   */
  async notifyError(error: unknown, context?: string): Promise<string | null> {
    // Always log to console for debugging
    logger.error(context || 'Error:', error)

    // Format the error message
    const formattedMessage = formatError(error)

    // Add context if provided
    const body = context ? `${context}: ${formattedMessage}` : formattedMessage

    // Use the existing notify method with error type
    const result = await this.notify({
      type: 'error',
      title: 'Error',
      body,
      metadata: {
        error: error instanceof Error ? error.stack : String(error),
        context: context || '',
        timestamp: new Date().toISOString(),
      },
      duration: 8000, // Errors should be visible longer
      priority: 'high',
    })

    // Return string or null (not the config object)
    return typeof result === 'string' ? result : null
  }

  /**
   * Convenience method for approval required notifications
   */
  async notifyApprovalRequired(
    sessionId: string,
    approvalId: string,
    toolName: string,
    toolInputJson: string,
    model?: string,
    sessionTitle?: string,
    returnToastConfig?: boolean,
  ) {
    const toastId = `approval_required:${approvalId}`

    // Truncate session title if it's too long
    const truncatedTitle = sessionTitle
      ? sessionTitle.length > 50
        ? sessionTitle.substring(0, 47) + '...'
        : sessionTitle
      : `Session ${sessionId.slice(0, 8)}`

    // Create title with warning color styling matching the session table
    // and session title on second line with muted color
    const titleElement = (
      <div className="flex flex-col gap-0.5">
        <span className="font-bold text-[var(--terminal-warning)]">needs_approval</span>
        <span className="text-xs text-muted-foreground">{truncatedTitle}</span>
      </div>
    )

    // Format the body with tool name highlighted in warning color
    const bodyElement = (
      <span>
        <code className="text-accent bg-muted/50 rounded-md px-1 py-0.5 font-mono">{toolName}</code>
        <span> using </span>
        <code className="text-accent bg-muted/50 rounded-md px-1 py-0.5 font-mono">
          {toolInputJson.length > 50 ? toolInputJson.substring(0, 47) + '...' : toolInputJson}
        </code>
      </span>
    )

    return this.notify({
      type: 'approval_required',
      title: titleElement,
      body: bodyElement,
      metadata: {
        sessionId,
        approvalId,
        model,
      },
      duration: Infinity, // Approval notifications should stick until dismissed
      actions: [
        {
          label: (
            <span className="flex items-center gap-1">
              Jump to Session
              <kbd className="ml-1 px-1.5 py-0.5 text-sm font-medium bg-background/50 rounded border border-border">
                {this.getModifierKey()}⇧J
              </kbd>
            </span>
          ),
          onClick: () => {
            window.location.hash = `/sessions/${sessionId}`
            // Dismiss the toast when user clicks to jump to session
            toast.dismiss(toastId)
          },
        },
      ],
      returnToastConfig,
    })
  }

  /**
   * Get current focus state
   */
  isAppFocused(): boolean {
    return this.appFocused
  }

  /**
   * Clear notification by approvalId
   */

  clearNotificationByApprovalId(approvalId: string) {
    const matchingToasts = toast
      .getToasts()
      .filter(toast => toast.id === `approval_required:${approvalId}`)

    logger.log('clearNotificationByApprovalId', matchingToasts)
    matchingToasts.forEach(toDismiss => toast.dismiss(toDismiss.id))
  }
}

// Export singleton instance with HMR support
let notificationService: NotificationService

// Clean up previous instance on hot reload
if (import.meta.hot) {
  logger.log('NotificationService: HMR detected, checking for previous instance')
  if ((import.meta as any).hot.data.notificationService) {
    logger.log('NotificationService: Cleaning up previous instance')
    ;(import.meta as any).hot.data.notificationService.cleanup()
  }
}

logger.log('NotificationService: Creating new instance')
notificationService = new NotificationService()

// Store instance for cleanup on next hot reload
if (import.meta.hot) {
  logger.log('NotificationService: Storing instance for future cleanup')
  ;(import.meta as any).hot.data.notificationService = notificationService
}

export { notificationService }
