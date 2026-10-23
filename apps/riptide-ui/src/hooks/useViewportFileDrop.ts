import { useLayoutEffect, useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { registerViewportFileDrop, type ViewportFileDropHandler } from '@/lib/viewport-file-drop'

/**
 * Lets a file dropped anywhere in the viewport reach this surface's upload.
 *
 * Pass `null` while the surface cannot take a file (no task, host offline);
 * the drop then falls through to whichever surface can, or to the navigation
 * guard. The handler is read through a ref, so the registration itself is
 * mount-scoped and never re-runs.
 */
export function useViewportFileDrop(handler: ViewportFileDropHandler | null): void {
	const handlerRef = useRef(handler)

	// Written after render, not during it: React may replay or discard a render.
	// A drop can only arrive from a later user event, so it always reads the
	// handler this pass committed.
	useLayoutEffect(() => {
		handlerRef.current = handler
	}, [handler])

	useMountEffect(() => registerViewportFileDrop({ getHandler: () => handlerRef.current }))
}
