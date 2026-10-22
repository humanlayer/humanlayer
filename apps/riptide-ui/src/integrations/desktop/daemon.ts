import {
	AuthenticationFailed,
	type DaemonLaunchResult,
	type DaemonLifecycleEvent,
	type DaemonSyncMode,
	RestartFailed,
	UnexpectedExit,
} from '@humanlayer/riptide-electron-rpc'

import * as electronDaemon from '@/integrations/electron/daemon'
import * as tauriDaemon from '@/integrations/tauri/daemon'
import { isElectron, isTauri } from '@/lib/utils'

export function shouldStartManagedDaemon(): boolean {
	if (isTauri()) return !import.meta.env.DEV || Boolean(import.meta.env.VITE_FORCE_DAEMON_IN_DEV)
	if (!isElectron()) return false
	if (!import.meta.env.DEV) return true
	const bridge = (window as Window & { __RIPTIDE_ELECTRON__?: { readonly daemonMode?: unknown } })
		.__RIPTIDE_ELECTRON__
	return bridge?.daemonMode === 'staged'
}

export async function startDaemon(
	token: string,
	userId: string,
	organizationId: string,
	syncMode: DaemonSyncMode,
	verifiedClaudePath: string | null,
): Promise<DaemonLaunchResult | null> {
	if (isElectron()) return electronDaemon.startDaemon(token, userId, organizationId, syncMode, verifiedClaudePath)
	if (isTauri()) return tauriDaemon.startDaemon(token, userId, organizationId, syncMode, verifiedClaudePath)
	return null
}

export async function stopDaemon(userId: string, organizationId: string): Promise<boolean> {
	if (isElectron()) {
		await electronDaemon.stopDaemon(userId, organizationId)
		return true
	}
	if (isTauri()) return tauriDaemon.stopDaemon(userId, organizationId)
	return false
}

/**
 * Opens or closes this desktop app's gate for local daemon starts and automatic restarts.
 * Turning it off also stops every daemon this app owns; it rejects if any may still be running.
 */
export async function setDaemonManagement(enabled: boolean): Promise<void> {
	if (isElectron()) return electronDaemon.setDaemonManagement(enabled)
	if (isTauri()) return tauriDaemon.setDaemonManagement(enabled)
}

export function isDaemonRunning(userId: string, organizationId: string): Promise<boolean> {
	if (isElectron()) return electronDaemon.isDaemonRunning(userId, organizationId)
	if (isTauri()) return tauriDaemon.isDaemonRunning(userId, organizationId)
	return Promise.resolve(false)
}

export async function onDaemonLifecycleEvent(
	callback: (event: DaemonLifecycleEvent) => void,
): Promise<(() => void) | null> {
	if (isElectron()) return electronDaemon.onDaemonLifecycleEvent(callback)
	if (!isTauri()) return null
	return tauriDaemon.onDaemonDied((event) => {
		if (event.auth_failure_message) {
			callback(
				AuthenticationFailed.make({
					userId: event.user_id,
					organizationId: event.organization_id,
					message: event.auth_failure_message,
				}),
			)
			return
		}
		callback(
			event.will_retry
				? UnexpectedExit.make({
						userId: event.user_id,
						organizationId: event.organization_id,
						exitCode: event.exit_code,
					})
				: RestartFailed.make({
						userId: event.user_id,
						organizationId: event.organization_id,
						message: 'Automatic daemon restart failed',
					}),
		)
	})
}
