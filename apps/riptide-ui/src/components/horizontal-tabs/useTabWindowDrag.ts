import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { startWindowDrag } from '@/integrations/electron/window'
import { isElectron } from '@/lib/utils'

/** Tauri uses the trigger's drag-region attribute; Electron must keep it clickable. */
export function useTabWindowDrag() {
	const cleanup = useRef<(() => void) | undefined>(undefined)
	useMountEffect(() => () => cleanup.current?.())

	return (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (!isElectron() || event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0 || event.ctrlKey) {
			return
		}
		cleanup.current?.()

		const target = event.currentTarget
		const pointerId = event.pointerId
		const listeners = new AbortController()
		// Keep receiving release/cancel even after the cursor leaves the tab/window.
		target.setPointerCapture(pointerId)
		const endDrag = startWindowDrag()
		const stop = () => {
			cleanup.current = undefined
			listeners.abort()
			endDrag()
			if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
		}
		const onPointerEnd = (event: PointerEvent) => {
			if (event.pointerId === pointerId) stop()
		}
		const onPointerMove = (event: PointerEvent) => {
			// Recover if the mouse was released outside the app without a pointerup.
			if (event.pointerId === pointerId && (event.buttons & 1) === 0) stop()
		}
		const options = { signal: listeners.signal }
		target.addEventListener('lostpointercapture', onPointerEnd, options)
		window.addEventListener('pointerup', onPointerEnd, options)
		window.addEventListener('pointercancel', onPointerEnd, options)
		window.addEventListener('pointermove', onPointerMove, options)
		window.addEventListener('blur', stop, options)
		window.addEventListener('pagehide', stop, options)
		cleanup.current = stop
		// Do not preventDefault: Radix still selects/focuses the tab on mousedown.
	}
}
