import { useMountEffect } from '@/hooks/useMountEffect'

import { claimPointerFocusArea, claimRightPaneFromWheel } from './keyboard-area-arbitration'

/** The sole document-level owner of spatial pointer/wheel keyboard arbitration. */
export function KeyboardAreaArbiter() {
	useMountEffect(() => {
		document.addEventListener('pointerdown', claimPointerFocusArea, true)
		document.addEventListener('wheel', claimRightPaneFromWheel, { capture: true, passive: true })
		return () => {
			document.removeEventListener('pointerdown', claimPointerFocusArea, true)
			document.removeEventListener('wheel', claimRightPaneFromWheel, true)
		}
	})

	return null
}
