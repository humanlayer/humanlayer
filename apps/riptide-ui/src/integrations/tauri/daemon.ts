import type { DaemonLaunchResult, DaemonSyncMode } from '@humanlayer/riptide-electron-rpc'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

export interface DaemonDiedEvent {
	user_id: string
	organization_id: string
	exit_code: number | null
	will_retry: boolean
	auth_failure_message?: string
}

/**
 * Get the host ID from the Tauri app.
 * Creates the host_id file if it doesn't exist.
 * Shows toast on error.
 */
export async function getHostId(): Promise<string | null> {
	if (!isTauri()) {
		return null
	}

	try {
		return await invoke<string>('get_host_id')
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to get host ID', { error: message })
		captureException(error instanceof Error ? error : new Error(message), {
			tags: { action: 'getHostId' },
		})
		toast.error('Failed to initialize device ID', {
			description: message,
		})
		return null
	}
}

/**
 * Start a daemon for the given user and organization.
 * Resolves after the candidate reports ready or hands off to an incumbent.
 * Rejects with the native error so each caller decides how to report it.
 */
export async function startDaemon(
	token: string,
	userId: string,
	organizationId: string,
	syncMode: DaemonSyncMode,
	verifiedClaudePath: string | null,
): Promise<DaemonLaunchResult | null> {
	if (!isTauri()) {
		return null
	}

	// Skip daemon spawn in dev mode - turbo-managed daemon handles this
	if (import.meta.env.DEV && !import.meta.env.VITE_FORCE_DAEMON_IN_DEV) {
		logger.debug('Skipping daemon spawn in dev mode (using turbo-managed daemon)')
		return null
	}

	try {
		logger.info('Starting daemon with requested sync mode', {
			userId,
			organizationId,
			syncMode,
			verifiedClaudePath,
		})

		return await invoke<DaemonLaunchResult>('start_daemon', {
			token,
			userId,
			organizationId,
			syncMode,
			verifiedClaudePath,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const failure = error instanceof Error ? error : new Error(message)
		logger.error('Failed to start daemon', { error: message })
		captureException(failure, {
			tags: { action: 'startDaemon' },
			extra: { userId, organizationId, syncMode },
		})
		throw failure
	}
}

/**
 * Stop the daemon for the given user and organization.
 * Shows toast on error.
 */
export async function stopDaemon(userId: string, organizationId: string): Promise<boolean> {
	if (!isTauri()) {
		return false
	}

	try {
		await invoke<void>('stop_daemon', {
			userId,
			organizationId,
		})
		return true
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to stop coding agent', { error: message })
		captureException(error instanceof Error ? error : new Error(message), {
			tags: { action: 'stopDaemon' },
			extra: { userId, organizationId },
		})
		toast.error('Failed to stop coding agent', {
			description: message,
		})
		return false
	}
}

/**
 * Turn local daemon management on or off. Turning it off stops every daemon this app owns.
 * Rejects with the native error so the caller can offer a retry.
 */
export async function setDaemonManagement(enabled: boolean): Promise<void> {
	if (!isTauri()) return
	await invoke<void>('set_daemon_management', { enabled })
}

/**
 * Check if a daemon is running for the given user and organization.
 */
export async function isDaemonRunning(userId: string, organizationId: string): Promise<boolean> {
	if (!isTauri()) {
		return false
	}

	try {
		return await invoke<boolean>('is_daemon_running', {
			userId,
			organizationId,
		})
	} catch (error) {
		logger.error('Failed to check daemon status', { error })
		return false
	}
}

/**
 * Listen for daemon-died events from the native layer.
 * Returns an unlisten function to stop listening.
 */
export async function onDaemonDied(callback: (event: DaemonDiedEvent) => void): Promise<UnlistenFn | null> {
	if (!isTauri()) {
		return null
	}

	try {
		return await listen<DaemonDiedEvent>('daemon-died', (event) => {
			callback(event.payload)
		})
	} catch (error) {
		logger.error('Failed to listen for daemon-died events', { error })
		return null
	}
}
