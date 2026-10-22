import {
	exportFeedbackMarkdown,
	type ArtifactDeliveryCapability,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback } from 'react'

import { useArtifactFeedbackDelivery, type ArtifactFeedbackDeliveryState } from './useArtifactFeedbackDelivery'

export type BulkArtifactDeliveryState = ArtifactFeedbackDeliveryState

/**
 * Bulk delivery over the controller's authoritative open-thread projection:
 * the shared delivery state machine fed with the every-open-thread payload.
 */
export function useBulkArtifactDelivery({
	artifactId,
	fileName,
	threads,
	capability,
	resolveBatch,
}: {
	artifactId: string
	fileName: string
	threads: readonly ProjectedCommentThread[]
	capability: ArtifactDeliveryCapability
	resolveBatch: (input: { artifactId: string; rootCommentIds: string[] }) => Promise<unknown>
}): BulkArtifactDeliveryState {
	const exportFeedback = useCallback(
		() => exportFeedbackMarkdown({ artifactId, fileName }, threads),
		[artifactId, fileName, threads],
	)
	return useArtifactFeedbackDelivery({ artifactId, capability, exportFeedback, resolveBatch })
}
