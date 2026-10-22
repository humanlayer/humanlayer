import { create } from 'zustand'

// The daemon reports ready only after its first heartbeat, but the host row still has to sync to this app.
const HOST_SYNC_GRACE_MS = 10_000

export type LocalDaemonLaunchPhase = 'idle' | 'starting' | 'syncing-host' | 'ready' | 'failed'

export function isLocalDaemonStarting(phase: LocalDaemonLaunchPhase): boolean {
	return phase === 'starting' || phase === 'syncing-host'
}

interface LocalDaemonLaunchState {
	phase: LocalDaemonLaunchPhase
	launchAttempt: number
	launchStarted: () => void
	launchSucceeded: () => void
	launchFailed: () => void
	retryLaunch: () => void
	reset: () => void
}

let hostSyncGraceTimer: ReturnType<typeof setTimeout> | undefined

export const useLocalDaemonLaunchStore = create<LocalDaemonLaunchState>()((set) => ({
	phase: 'idle',
	launchAttempt: 0,
	launchStarted: () => {
		clearTimeout(hostSyncGraceTimer)
		set({ phase: 'starting' })
	},
	launchSucceeded: () => {
		clearTimeout(hostSyncGraceTimer)
		set({ phase: 'syncing-host' })
		hostSyncGraceTimer = setTimeout(() => set({ phase: 'ready' }), HOST_SYNC_GRACE_MS)
	},
	launchFailed: () => {
		clearTimeout(hostSyncGraceTimer)
		set({ phase: 'failed' })
	},
	reset: () => {
		clearTimeout(hostSyncGraceTimer)
		set({ phase: 'idle' })
	},
	retryLaunch: () => {
		set((state) =>
			state.phase === 'failed' ? { phase: 'starting', launchAttempt: state.launchAttempt + 1 } : state,
		)
	},
}))
