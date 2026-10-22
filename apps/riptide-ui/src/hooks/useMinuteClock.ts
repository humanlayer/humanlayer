import { useSyncExternalStore } from 'react'

const MINUTE_MS = 60_000
const listeners = new Set<() => void>()
let currentTime = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void): () => void {
	listeners.add(listener)
	if (listeners.size === 1) {
		currentTime = Date.now()
		timer = setInterval(() => {
			currentTime = Date.now()
			for (const notify of listeners) notify()
		}, MINUTE_MS)
	}
	return () => {
		listeners.delete(listener)
		if (listeners.size === 0) clearInterval(timer)
	}
}

export function useMinuteClock(): number {
	return useSyncExternalStore(subscribe, () => currentTime)
}
