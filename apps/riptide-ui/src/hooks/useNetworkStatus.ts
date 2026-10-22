import { useSyncExternalStore } from 'react'

type NetworkStatus = 'online' | 'offline'

function subscribe(callback: () => void) {
	window.addEventListener('online', callback)
	window.addEventListener('offline', callback)
	return () => {
		window.removeEventListener('online', callback)
		window.removeEventListener('offline', callback)
	}
}

function getSnapshot(): NetworkStatus {
	return window.navigator.onLine ? 'online' : 'offline'
}

export function useNetworkStatus(): NetworkStatus {
	return useSyncExternalStore(subscribe, getSnapshot)
}
