import {
	exportThreadFeedbackMarkdown,
	type ArtifactDeliveryCapability,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback } from 'react'

import { useArtifactFeedbackDelivery, type ArtifactFeedbackDeliveryState } from './useArtifactFeedbackDelivery'

export type ThreadArtifactDeliveryState = ArtifactFeedbackDeliveryState

/**
 * Per-thread delivery for one open root thread: the shared delivery state
 * machine (same idle-submit/running-queue dispatcher, pending/operation-ID
 * guards, acceptance-gated resolution, and resolve-only recovery as bulk) fed
 * with a one-thread payload — the root plus all its replies, never siblings.
 * Send & Resolve resolves ONLY this root after send/queue acceptance; the
 * exporter returns null once the root is resolved/deleted, so a stale control
 * fails visibly instead of dispatching.
 */
export function useThreadArtifactDelivery({
	artifactId,
	fileName,
	thread,
	capability,
	resolveBatch,
}: {
	artifactId: string
	fileName: string
	thread: ProjectedCommentThread
	capability: ArtifactDeliveryCapability
	resolveBatch: (input: { artifactId: string; rootCommentIds: string[] }) => Promise<unknown>
}): ThreadArtifactDeliveryState {
	const exportFeedback = useCallback(
		() => exportThreadFeedbackMarkdown({ artifactId, fileName }, thread),
		[artifactId, fileName, thread],
	)
	return useArtifactFeedbackDelivery({ artifactId, capability, exportFeedback, resolveBatch })
}
