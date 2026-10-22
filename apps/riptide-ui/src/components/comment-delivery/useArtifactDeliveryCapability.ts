import type { Session } from '@humanlayer/db/tables/sessions'
import type { ArtifactDeliveryCapability } from '@humanlayer/ui/artifact-viewer-v2'

import { getSessionDeliveryCapability, useSessionRow } from './useSessionDeliveryCapability'

/**
 * Artifact feedback is addressed to a task, and the focused session can belong to another one,
 * so a session outside the task copies rather than sends.
 */
export function getArtifactDeliveryCapability(
	session: Pick<Session, 'id' | 'task_id' | 'status'> | null | undefined,
	taskId: string,
): ArtifactDeliveryCapability {
	if (!session || session.task_id !== taskId) return { kind: 'copy' }
	return getSessionDeliveryCapability(session)
}

export function useArtifactDeliveryCapability({
	sessionId,
	taskId,
}: {
	sessionId: string | undefined
	taskId: string
}): ArtifactDeliveryCapability {
	return getArtifactDeliveryCapability(useSessionRow(sessionId), taskId)
}
