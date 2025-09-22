import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { logger } from '@/lib/logging'

interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

class WindowStateService {
  private debounceTimer: NodeJS.Timeout | null = null
  private unlisteners: Array<() => void> = []

  async initialize() {
    try {
      // Setup event listeners to save window state changes
      // Note: Window restoration is handled in Rust during app setup
      await this.attachListeners()
    } catch (error) {
      logger.error('Failed to initialize window state service:', error)
    }
  }

  private async attachListeners() {
    const appWindow = getCurrentWindow()

    // Listen for resize events
    const unlistenResize = await appWindow.onResized(() => {
      this.debounceSaveState()
    })
    this.unlisteners.push(unlistenResize)

    // Listen for move events
    const unlistenMove = await appWindow.onMoved(() => {
      this.debounceSaveState()
    })
    this.unlisteners.push(unlistenMove)
  }

  private debounceSaveState() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.saveCurrentState()
    }, 500)
  }

  private async saveCurrentState() {
    try {
      const appWindow = getCurrentWindow()

      const size = await appWindow.innerSize()
      const position = await appWindow.outerPosition()
      const isMaximized = await appWindow.isMaximized()

      const state: WindowState = {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized: isMaximized,
      }

      await invoke('save_window_state', { state })
    } catch (error) {
      logger.error('Failed to save window state:', error)
    }
  }

  destroy() {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    // Remove all listeners
    this.unlisteners.forEach(unlisten => unlisten())
    this.unlisteners = []
  }
}

export const windowStateService = new WindowStateService()
