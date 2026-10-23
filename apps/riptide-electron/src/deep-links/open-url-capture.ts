import { app } from 'electron'

type OpenUrlListener = (url: string) => void

const pendingOpenUrls: string[] = []
const listeners = new Set<OpenUrlListener>()

const captureOpenUrl = (event: Electron.Event, url: string): void => {
	event.preventDefault()
	if (listeners.size === 0) {
		pendingOpenUrls.push(url)
		return
	}
	for (const listener of listeners) listener(url)
}

app.on('open-url', captureOpenUrl)

export function subscribeToCapturedOpenUrls(listener: OpenUrlListener): () => void {
	listeners.add(listener)
	const capturedBeforeSubscription = pendingOpenUrls.splice(0)
	for (const url of capturedBeforeSubscription) listener(url)
	return () => listeners.delete(listener)
}
