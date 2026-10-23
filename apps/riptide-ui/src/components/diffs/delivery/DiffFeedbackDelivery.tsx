import { BulkDeliveryControl } from '@humanlayer/ui/artifact-viewer-v2'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { useMountEffect } from '@/hooks/useMountEffect'

import { diffFeedbackDeliveryTraySlotId } from './tray-slot'
import type { DiffFeedbackDeliveryModel } from './use-diff-feedback-delivery'

export function DiffFeedbackDelivery({ sessionId, model }: { sessionId: string; model: DiffFeedbackDeliveryModel }) {
	const [trayTarget, setTrayTarget] = useState<HTMLElement | null>(null)
	useMountEffect(() => {
		const syncTarget = () => setTrayTarget(document.getElementById(diffFeedbackDeliveryTraySlotId(sessionId)))
		syncTarget()
		const observer = new MutationObserver(syncTarget)
		observer.observe(document.body, { childList: true, subtree: true })
		return () => observer.disconnect()
	})

	if (!trayTarget || model.count === 0) return null
	const control =
		model.capability.kind === 'copy' ? (
			<BulkDeliveryControl
				capability={model.capability}
				mode={model.mode}
				count={model.count}
				pending={model.pending}
				error={model.error}
				onCopy={model.copyAll}
				isNarrow
				showShortcut={false}
			/>
		) : (
			<BulkDeliveryControl
				capability={model.capability}
				mode={model.mode}
				count={model.count}
				pending={model.pending}
				error={model.error}
				onDeliver={model.deliverAll}
				onModeChange={model.setMode}
				onResolveSentComments={model.resolveSentComments}
				isNarrow
				showShortcut={false}
			/>
		)
	return createPortal(control, trayTarget)
}
