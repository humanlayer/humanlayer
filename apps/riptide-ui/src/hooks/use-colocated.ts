import { useSyncExternalStore } from 'react'

import { getHostId } from '@/integrations/desktop/host'
import { isDesktop } from '@/lib/utils'

export interface LocalHostIdState {
	localHostId: string | null
	isResolved: boolean
}

const BROWSER_STATE: LocalHostIdState = { localHostId: null, isResolved: true }
const UNRESOLVED_STATE: LocalHostIdState = { localHostId: null, isResolved: false }
const FAILED_STATE: LocalHostIdState = { localHostId: null, isResolved: true }

const HOST_ID_TIMEOUT_MS = 2_500

let processHostIdState: LocalHostIdState = UNRESOLVED_STATE
let processHostIdRequest: Promise<void> | null = null
let processHostIdTimeout: ReturnType<typeof setTimeout> | undefined
const processHostIdListeners = new Set<() => void>()

function settleProcessHostId(state: LocalHostIdState) {
	processHostIdState = state
	for (const listener of processHostIdListeners) listener()
}

function requestProcessHostId() {
	if (processHostIdRequest) return
	const request: Promise<void> = getHostId().then(
		(localHostId) => {
			if (processHostIdRequest !== request) return
			clearTimeout(processHostIdTimeout)
			settleProcessHostId({ localHostId, isResolved: true })
		},
		() => {
			if (processHostIdRequest !== request) return
			clearTimeout(processHostIdTimeout)
			processHostIdRequest = null
			settleProcessHostId(FAILED_STATE)
		},
	)
	processHostIdRequest = request
	processHostIdTimeout = setTimeout(() => {
		if (processHostIdState === UNRESOLVED_STATE) settleProcessHostId(FAILED_STATE)
	}, HOST_ID_TIMEOUT_MS)
}

export function resetLocalHostIdForTesting() {
	clearTimeout(processHostIdTimeout)
	processHostIdRequest = null
	processHostIdState = UNRESOLVED_STATE
}

function subscribeToProcessHostId(listener: () => void) {
	processHostIdListeners.add(listener)
	if (isDesktop() && (processHostIdState === UNRESOLVED_STATE || processHostIdState === FAILED_STATE)) {
		requestProcessHostId()
	}
	return () => {
		processHostIdListeners.delete(listener)
	}
}

function readProcessHostId(): LocalHostIdState {
	return isDesktop() ? processHostIdState : BROWSER_STATE
}

/** Host id of the daemon on this machine; null in the browser or until the desktop shell answers. */
export function useLocalHostIdState(): LocalHostIdState {
	return useSyncExternalStore(subscribeToProcessHostId, readProcessHostId, readProcessHostId)
}

export function useLocalHostId(): string | null {
	return useLocalHostIdState().localHostId
}

/**
 * Determines if the given hostId matches the local Tauri host.
 * Returns { isColocated: true } when the selected host is the same machine
 * running the Tauri app, false for remote hosts, and false in non-Tauri (browser).
 */
export function useIsColocated(hostId: string | null | undefined) {
	const localHostId = useLocalHostId()

	const isColocated = Boolean(localHostId && hostId && localHostId === hostId)

	return { isColocated, localHostId }
}
