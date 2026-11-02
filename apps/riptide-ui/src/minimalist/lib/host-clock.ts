import { useSyncExternalStore } from 'react'

/** A host whose last heartbeat is older than this is stale; the daemon beats every 15 s. */
export const STALE_AFTER_MS = 30_000
/** How long after a wake a host that was live before it keeps reading live while fresh rows arrive. */
export const RESUME_GRACE_MS = 20_000

const CHECK_MS = 5_000
const TICK_MS = 15_000
// Timers pause while the machine sleeps; a check this late means it slept.
const SLEPT_AFTER_MS = CHECK_MS + 15_000

export type HostClock = {
	now: number
	/** When synced rows last flowed: the last check before sleep, or when the window hid. 0 before any pause. */
	pausedAt: number
	/** When the window came back from sleep or from hiding. 0 before any pause. */
	resumedAt: number
}

let clock: HostClock = { now: Date.now(), pausedAt: 0, resumedAt: 0 }
let lastCheck = 0
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function publish(next: HostClock) {
	clock = next
	for (const listener of listeners) listener()
}

function resume() {
	const now = Date.now()
	publish({ now, pausedAt: lastCheck, resumedAt: now })
	lastCheck = now
}

function check() {
	// While hidden, sync pauses too; the visibility change marks the pause and the return.
	if (document.visibilityState !== 'visible') return
	const now = Date.now()
	if (now - lastCheck > SLEPT_AFTER_MS) return resume()
	lastCheck = now
	if (now - clock.now >= TICK_MS) publish({ ...clock, now })
}

function onVisibilityChange() {
	if (document.visibilityState === 'visible') resume()
	else lastCheck = Date.now()
}

function subscribe(listener: () => void) {
	listeners.add(listener)
	if (listeners.size === 1) {
		lastCheck = Date.now()
		clock = { ...clock, now: lastCheck }
		timer = setInterval(check, CHECK_MS)
		document.addEventListener('visibilitychange', onVisibilityChange)
	}
	return () => {
		listeners.delete(listener)
		if (listeners.size > 0) return
		clearInterval(timer)
		document.removeEventListener('visibilitychange', onVisibilityChange)
	}
}

/**
 * The time for host status: ticks every 15 s so a host that stops beating turns stale on screen,
 * and notes when the window comes back from sleep or from hiding.
 */
export function useHostClock(): HostClock {
	return useSyncExternalStore(subscribe, () => clock)
}

/**
 * Whether a host reads live. Right after a wake the rows on hand predate the pause, so a host that was
 * live when sync paused stays live for a short grace, even if the server marked it offline meanwhile.
 * Its daemon may have slept too, and its first beat after wake is on the way.
 */
export function hostLiveness(
	status: 'online' | 'offline',
	lastSeen: number,
	clock: HostClock,
): { online: boolean; stale: boolean } {
	const stale = clock.now - lastSeen > STALE_AFTER_MS
	const inGrace = clock.now - clock.resumedAt < RESUME_GRACE_MS && clock.pausedAt - lastSeen <= STALE_AFTER_MS
	if (inGrace) return { online: true, stale: false }
	return { online: status === 'online' && !stale, stale }
}

export function resetHostClockForTests() {
	clock = { now: Date.now(), pausedAt: 0, resumedAt: 0 }
	lastCheck = 0
}
