import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function takePendingDeepLink(): Promise<{ readonly url: string } | null> {
	return invoke<string | null>('take_pending_deep_link').then((url) => (url === null ? null : { url }))
}

export function onDeepLink(callback: (link: { readonly url: string }) => void): Promise<() => void> {
	return listen<string>('deep-link', (event) => callback({ url: event.payload }))
}
