import { create } from 'zustand'

import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { setDaemonManagement } from '@/integrations/desktop/daemon'
import { logger } from '@/lib/logger'

/**
 * Progress of stopping this app's local daemons. Kept apart from the saved `localDaemonEnabled`
 * preference: the preference records what the user wants, this records whether stopping worked.
 */
export type LocalDaemonStopStatus = 'idle' | 'stopping' | 'failed'

interface LocalDaemonPolicyState {
	stopStatus: LocalDaemonStopStatus
}

export const useLocalDaemonPolicyStore = create<LocalDaemonPolicyState>()(() => ({ stopStatus: 'idle' }))

// Policy changes run one at a time and in request order, so an older enable cannot land after a
// newer disable. Each run handles its own errors, so the queue never rejects.
let policyQueue: Promise<void> = Promise.resolve()
let latestRequest = 0

function applyLocalDaemonPolicy(enabled: boolean): Promise<void> {
	const request = ++latestRequest
	const isLatest = () => request === latestRequest
	if (!enabled) useLocalDaemonPolicyStore.setState({ stopStatus: 'stopping' })
	const run = policyQueue.then(async () => {
		try {
			await setDaemonManagement(enabled)
			if (isLatest()) useLocalDaemonPolicyStore.setState({ stopStatus: 'idle' })
		} catch (error) {
			logger.error('Failed to apply local daemon setting', {
				enabled,
				error: error instanceof Error ? error.message : String(error),
			})
			if (isLatest()) useLocalDaemonPolicyStore.setState({ stopStatus: enabled ? 'idle' : 'failed' })
		}
	})
	policyQueue = run
	return run
}

/** Resolves once every requested policy change has reached the desktop app. */
export function whenLocalDaemonPolicySettled(): Promise<void> {
	return policyQueue
}

/** Reapplies the saved preference, e.g. after the renderer reloads while the desktop app keeps running. */
export function applySavedLocalDaemonPolicy(): Promise<void> {
	return applyLocalDaemonPolicy(useSettingsStore.getState().localDaemonEnabled)
}

export function turnOffLocalDaemon(): Promise<void> {
	useSettingsStore.getState().setLocalDaemonEnabled(false)
	useLocalDaemonLaunchStore.getState().reset()
	return applyLocalDaemonPolicy(false)
}

export function retryStoppingLocalDaemon(): Promise<void> {
	return applyLocalDaemonPolicy(false)
}

/** Reopens the desktop gate; `useDaemonManager` then starts a daemon for the current identity. */
export function turnOnLocalDaemon(): Promise<void> {
	useSettingsStore.getState().setLocalDaemonEnabled(true)
	return applyLocalDaemonPolicy(true)
}
