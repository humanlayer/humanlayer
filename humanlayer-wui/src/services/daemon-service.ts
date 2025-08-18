import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/lib/logging'

export interface DaemonInfo {
  port: number
  pid: number
  database_path: string
  branch_id: string
}

export interface DaemonConfig {
  branch_id: string
  port: number
  database_path: string
  last_used: string
}

class DaemonService {
  private static instance: DaemonService

  static getInstance(): DaemonService {
    if (!DaemonService.instance) {
      DaemonService.instance = new DaemonService()
    }
    return DaemonService.instance
  }

  async startDaemon(isDev: boolean = false, branchOverride?: string): Promise<DaemonInfo> {
    try {
      return await invoke<DaemonInfo>('start_daemon', { isDev, branchOverride })
    } catch (error) {
      throw new Error(`Failed to start daemon: ${error}`)
    }
  }

  async stopDaemon(): Promise<void> {
    try {
      await invoke('stop_daemon')
    } catch (error) {
      throw new Error(`Failed to stop daemon: ${error}`)
    }
  }

  async getDaemonInfo(isDev: boolean = import.meta.env.DEV): Promise<DaemonInfo | null> {
    try {
      return await invoke<DaemonInfo | null>('get_daemon_info', { isDev })
    } catch (error) {
      logger.error('Failed to get daemon info:', error)
      return null
    }
  }

  async isDaemonRunning(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_daemon_running')
    } catch (error) {
      logger.error('Failed to check daemon status:', error)
      return false
    }
  }

  async getStoredConfigs(): Promise<DaemonConfig[]> {
    try {
      return await invoke<DaemonConfig[]>('get_stored_configs')
    } catch (error) {
      logger.error('Failed to get stored configs:', error)
      return []
    }
  }

  async getConfigPath(): Promise<string> {
    try {
      return await invoke<string>('get_config_path')
    } catch {
      return 'unknown'
    }
  }

  async connectToExisting(url: string): Promise<void> {
    // Validate URL format
    try {
      new URL(url)
    } catch {
      throw new Error(`Invalid URL format: ${url}`)
    }

    // Store the custom URL temporarily (not in Tauri store)
    ;(window as any).__HUMANLAYER_DAEMON_URL = url
    ;(window as any).__HUMANLAYER_DAEMON_TYPE = 'external'
  }

  async switchToManagedDaemon(): Promise<void> {
    // Clear the custom URL to switch back to managed daemon
    delete (window as any).__HUMANLAYER_DAEMON_URL
    delete (window as any).__HUMANLAYER_DAEMON_TYPE
  }

  getDaemonType(): 'managed' | 'external' {
    return (window as any).__HUMANLAYER_DAEMON_TYPE || 'managed'
  }
}

export const daemonService = DaemonService.getInstance()
