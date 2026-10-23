import { ThreadDeliveryControl, type ProjectedCommentThread } from '@humanlayer/ui/artifact-viewer-v2'

import type { ArtifactReviewDelivery } from '../ArtifactViewerV2'
import { useThreadArtifactDelivery } from './useThreadArtifactDelivery'

/**
 * Wired per-thread delivery leaf, composed by the rail into every OPEN root
 * thread's delivery slot. Binds one root thread to the shared capability, the
 * immediate send/queue dispatcher. Per-thread delivery is intentionally send
 * only; send-and-resolve remains a bulk-review action. Intentionally NOT in the
 * command palette; the control lives on the visible thread card only.
 */
export function ArtifactThreadDelivery({
	artifactId,
	fileName,
	delivery: { capability, resolveBatch },
	thread,
}: {
	artifactId: string
	fileName: string
	delivery: ArtifactReviewDelivery
	thread: ProjectedCommentThread
}) {
	const delivery = useThreadArtifactDelivery({ artifactId, fileName, thread, capability, resolveBatch })

	if (capability.kind === 'copy') {
		return (
			<ThreadDeliveryControl
				capability={capability}
				pending={delivery.pending}
				error={delivery.error}
				onCopy={() => void delivery.copy()}
			/>
		)
	}
	return (
		<ThreadDeliveryControl
			capability={capability}
			pending={delivery.pending}
			error={delivery.error}
			onDeliver={() => void delivery.deliver('send')}
		/>
	)
}
