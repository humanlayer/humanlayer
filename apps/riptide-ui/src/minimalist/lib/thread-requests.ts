import { useLayoutEffect, useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { matchShortcut } from '@/minimalist/lib/shortcuts'

/** What the palette can ask of the open thread. The thread owns the dialogs; others only ask. */
export type ThreadRequest = { kind: 'fork' } | { kind: 'handoff'; model: string }

const THREAD_REQUEST = 'minimalist:thread-request'

export function requestThread(request: ThreadRequest) {
	window.dispatchEvent(new CustomEvent<ThreadRequest>(THREAD_REQUEST, { detail: request }))
}

/** Calls `onRequest` for palette requests, and for ⌘Y as a fork, while the thread is mounted. */
export function useThreadRequests(onRequest: (request: ThreadRequest) => void, enabled = true) {
	const handle = useRef(onRequest)
	const enabledRef = useRef(enabled)
	useLayoutEffect(() => {
		handle.current = onRequest
		enabledRef.current = enabled
	}, [onRequest, enabled])
	useMountEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!enabledRef.current || event.defaultPrevented || matchShortcut(event)?.id !== 'fork') return
			event.preventDefault()
			handle.current({ kind: 'fork' })
		}
		const onEvent = (event: Event) => {
			if (!enabledRef.current) return
			handle.current((event as CustomEvent<ThreadRequest>).detail)
		}
		window.addEventListener('keydown', onKey)
		window.addEventListener(THREAD_REQUEST, onEvent)
		return () => {
			window.removeEventListener('keydown', onKey)
			window.removeEventListener(THREAD_REQUEST, onEvent)
		}
	})
}
