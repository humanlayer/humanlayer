import { toast, type ExternalToast } from 'sonner'
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Types for generic notification system
export type NotificationType =
  | 'approval_required'
  | 'session_completed'
  | 'session_failed'
  | 'session_started'
  | 'system_alert'

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationOptions {
  type: NotificationType
  title: string
  body: string
  metadata: {
    sessionId?: string
    approvalId?: string
    [key: string]: any
  }
  actions?: NotificationAction[]
  duration?: number | null
  priority?: 'low' | 'normal' | 'high'
}

class NotificationService {
  private appFocused: boolean = true
  private focusHandler: (() => void) | null = null
  private blurHandler: (() => void) | null = null
  private unlistenFocus: (() => void) | null = null
  private unlistenBlur: (() => void) | null = null

  constructor() {
    console.log('NotificationService: Constructor called')
    this.attachFocusListeners()
  }

  private async attachFocusListeners() {
    console.log('NotificationService: Attaching focus listeners')

    // Clean up any existing listeners first
    await this.detachFocusListeners()

    try {
      // Try Tauri window events first
      const appWindow = getCurrentWindow()

      // Listen for focus events
      this.unlistenFocus = await appWindow.onFocusChanged(event => {
        console.log('Tauri window focus changed:', event)
        this.appFocused = event.payload
      })

      // Also use standard window events as fallback
      this.focusHandler = () => {
        console.log('window focused (standard event)')
        this.appFocused = true
      }

      this.blurHandler = () => {
        console.log('window blurred (standard event)')
        this.appFocused = false
      }

      window.addEventListener('focus', this.focusHandler)
      window.addEventListener('blur', this.blurHandler)

      console.log('NotificationService: Focus listeners attached')
    } catch (error) {
      console.error('Failed to attach Tauri focus listeners, using standard events only:', error)

      // Fallback to standard events only
      this.focusHandler = () => {
        console.log('window focused')
        this.appFocused = true
      }

      this.blurHandler = () => {
        console.log('window blurred')
        this.appFocused = false
      }

      window.addEventListener('focus', this.focusHandler)
      window.addEventListener('blur', this.blurHandler)
    }
  }

  private async detachFocusListeners() {
    console.log('NotificationService: Detaching focus listeners', {
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
    console.log('NotificationService: Cleanup called')
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
   * Check if user should be notified based on current context
   */
  private shouldNotify(options: NotificationOptions): boolean {
    // Check if user is viewing the relevant session
    if (options.metadata.sessionId && this.isViewingSession(options.metadata.sessionId)) {
      console.log(
        `Skipping notification: User is already viewing session ${options.metadata.sessionId}`,
      )
      return false
    }

    // Future: Add more context-aware checks here
    return true
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
  async notify(options: NotificationOptions): Promise<string | null> {
    // Check if we should show this notification
    if (!this.shouldNotify(options)) {
      return null
    }

    // Generate unique ID for this notification
    const notificationId = this.generateNotificationId(options.type, options.metadata)

    console.log('NotificationService.notify:', {
      appFocused: this.appFocused,
      notificationType: options.type,
      sessionId: options.metadata.sessionId,
    })

    if (this.appFocused) {
      this.showInAppNotification(options)
    } else {
      await this.showOSNotification(options)
    }

    return notificationId
  }

  /**
   * Show in-app notification using Sonner
   */
  private showInAppNotification(options: NotificationOptions) {
    const toastOptions: ExternalToast = {
      description: options.body,
      duration: options.duration ?? 5000, // Default 5 seconds if undefined
      closeButton: true, // Always show close button for better UX
    }

    // Add primary action if provided
    if (options.actions && options.actions.length > 0) {
      const primaryAction = options.actions[0]
      toastOptions.action = {
        label: primaryAction.label,
        onClick: primaryAction.onClick,
      }
    }

    // Show toast based on type/priority
    switch (options.type) {
      case 'session_failed':
        toast.error(options.title, toastOptions)
        break
      case 'session_completed':
        toast.success(options.title, toastOptions)
        break
      default:
        toast(options.title, toastOptions)
    }
  }

  /**
   * Show OS-level notification using Tauri plugin
   */
  private async showOSNotification(options: NotificationOptions) {
    console.log('NotificationService.showOSNotification called:', options.title)
    try {
      // Check if we have permission
      let permissionGranted = await isPermissionGranted()
      console.log('OS notification permission granted:', permissionGranted)

      // Request permission if not granted
      if (!permissionGranted) {
        const permission = await requestPermission()
        permissionGranted = permission === 'granted'
      }

      if (!permissionGranted) {
        console.warn('Notification permission not granted, falling back to in-app notification')
        this.showInAppNotification(options)
        return
      }

      // Send the notification
      await sendNotification({
        title: options.title,
        body: options.body,
        // We can't directly handle clicks on OS notifications to navigate,
        // but at least the notification will bring attention to the app
      })
    } catch (error) {
      console.error('Failed to show OS notification:', error)
      // Fallback to in-app notification
      this.showInAppNotification(options)
    }
  }

  /**
   * Convenience method for approval required notifications
   */
  async notifyApprovalRequired(sessionId: string, approvalId: string, query: string, model?: string) {
    const body = this.formatQueryBody(query, model)

    return this.notify({
      type: 'approval_required',
      title: `Approval Requested (${sessionId.slice(0, 8)})`,
      body,
      metadata: {
        sessionId,
        approvalId,
        model,
      },
      duration: Infinity, // Approval notifications should stick until dismissed
      actions: [
        {
          label: 'Jump to Session',
          onClick: () => {
            window.location.hash = `/sessions/${sessionId}`
          },
        },
      ],
    })
  }

  /**
   * Format query for notification body
   */
  private formatQueryBody(query: string, model?: string): string {
    // Truncate query to 100 chars
    const truncatedQuery = query.length > 100 ? query.substring(0, 97) + '...' : query

    if (model) {
      return `${model}: ${truncatedQuery}`
    }

    return truncatedQuery
  }

  /**
   * Get current focus state
   */
  isAppFocused(): boolean {
    return this.appFocused
  }
}

// Export singleton instance with HMR support
let notificationService: NotificationService

// Clean up previous instance on hot reload
if (import.meta.hot) {
  console.log('NotificationService: HMR detected, checking for previous instance')
  if ((import.meta as any).hot.data.notificationService) {
    console.log('NotificationService: Cleaning up previous instance')
    ;(import.meta as any).hot.data.notificationService.cleanup()
  }
}

console.log('NotificationService: Creating new instance')
notificationService = new NotificationService()

// Store instance for cleanup on next hot reload
if (import.meta.hot) {
  console.log('NotificationService: Storing instance for future cleanup')
  ;(import.meta as any).hot.data.notificationService = notificationService
}

export { notificationService }
