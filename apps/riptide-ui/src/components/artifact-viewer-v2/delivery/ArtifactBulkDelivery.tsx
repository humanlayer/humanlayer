import { BulkDeliveryControl } from '@humanlayer/ui/artifact-viewer-v2'

import type { ArtifactBulkDeliveryModel } from './useCommentSendCommandPaletteActionsAndHotkeys'

export function ArtifactBulkDelivery({
	model,
	isNarrow = false,
	primaryLabel,
	className,
}: {
	model: ArtifactBulkDeliveryModel
	isNarrow?: boolean
	primaryLabel?: string
	className?: string
}) {
	if (model.capability.kind === 'copy') {
		return (
			<BulkDeliveryControl
				capability={model.capability}
				mode={model.mode}
				count={model.count}
				pending={model.pending}
				error={model.error}
				onCopy={model.copy}
				isNarrow={isNarrow}
				primaryLabel={primaryLabel}
				className={className}
			/>
		)
	}
	return (
		<BulkDeliveryControl
			capability={model.capability}
			mode={model.mode}
			count={model.count}
			pending={model.pending}
			error={model.error}
			onDeliver={model.execute}
			onModeChange={model.setMode}
			onResolveSentComments={model.resolveSentComments}
			isNarrow={isNarrow}
			primaryLabel={primaryLabel}
			className={className}
		/>
	)
}
