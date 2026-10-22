import type {
	ArtifactDeliveryCapability,
	ArtifactDeliveryMode,
	ArtifactDeliveryResult,
	ExportedArtifactFeedback,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback, useRef, useState } from 'react'

import { useSessionDelivery } from '@/components/comment-delivery/useSessionDelivery'

import { executeBulkArtifactDelivery } from './executeBulkArtifactDelivery'

export interface ArtifactFeedbackDeliveryState {
	pending: boolean
	error: string | null
	recoveryRootIds: readonly string[] | null
	deliver: (mode: ArtifactDeliveryMode) => Promise<ArtifactDeliveryResult>
	copy: () => Promise<ArtifactDeliveryResult>
	resolveSentComments: () => Promise<ArtifactDeliveryResult>
}

const MESSAGES = {
	sent: 'Your comments have been sent to the agent.',
	queued: 'Agent is currently working. Your comments have been queued.',
} as const

/**
 * Shared delivery state machine behind the bulk and per-thread controls: one
 * pending/operation guard, visible-error-never-clipboard failure handling,
 * acceptance-gated resolution through the explicit-root batch resolver, and
 * the "delivered but resolve failed" resolve-only recovery. Callers supply the
 * payload seam (`exportFeedback`) — bulk exports every open thread, per-thread
 * exports exactly one root plus its replies (`null` once that root resolved).
 */
export function useArtifactFeedbackDelivery({
	artifactId,
	capability,
	exportFeedback,
	resolveBatch,
}: {
	artifactId: string
	capability: ArtifactDeliveryCapability
	/** Nullable: the per-thread exporter returns null once its root is resolved/deleted. */
	exportFeedback: () => ExportedArtifactFeedback | null
	resolveBatch: (input: { artifactId: string; rootCommentIds: string[] }) => Promise<unknown>
}): ArtifactFeedbackDeliveryState {
	const session = useSessionDelivery(capability, MESSAGES)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [recoveryRootIds, setRecoveryRootIds] = useState<readonly string[] | null>(null)
	const pendingRef = useRef(false)

	const copy = useCallback(async (): Promise<ArtifactDeliveryResult> => {
		if (pendingRef.current) return { kind: 'failed', message: 'A delivery operation is already pending.' }
		pendingRef.current = true
		setPending(true)
		try {
			setError(null)
			setRecoveryRootIds(null)
			const feedback = exportFeedback()
			if (!feedback) {
				setError('There is no open feedback to copy.')
				return { kind: 'failed', message: 'There is no open feedback to copy.' } as const
			}
			if (await session.copy(feedback.markdown)) return { kind: 'copied' } as const
			setError('Feedback could not be copied.')
			return { kind: 'failed', message: 'Feedback could not be copied.' } as const
		} finally {
			pendingRef.current = false
			setPending(false)
		}
	}, [exportFeedback, session])

	const deliver = useCallback(
		async (mode: ArtifactDeliveryMode): Promise<ArtifactDeliveryResult> => {
			if (capability.kind === 'copy') return copy()
			if (pendingRef.current) return { kind: 'failed', message: 'A delivery operation is already pending.' }
			pendingRef.current = true
			setPending(true)
			try {
				setError(null)
				setRecoveryRootIds(null)
				const feedback = exportFeedback()
				if (!feedback) {
					setError('There is no open feedback to deliver.')
					return { kind: 'failed', message: 'There is no open feedback to deliver.' } as const
				}
				const deliveryResult = await executeBulkArtifactDelivery({
					capability,
					mode,
					feedback,
					dispatch: (_intent, markdown) => session.dispatch(markdown),
					confirm: session.confirm,
					resolveBatch: (rootCommentIds) =>
						resolveBatch({ artifactId, rootCommentIds: [...rootCommentIds] }).then(() => {}),
				})
				if (deliveryResult.kind === 'failed') {
					setError('Feedback could not be delivered.')
				} else if (deliveryResult.kind === 'delivered-resolution-failed') {
					setRecoveryRootIds(deliveryResult.rootCommentIds)
					setError('Sent, but comments could not be resolved.')
				}
				return deliveryResult
			} finally {
				pendingRef.current = false
				setPending(false)
			}
		},
		[artifactId, capability, copy, exportFeedback, resolveBatch, session],
	)

	const resolveSentComments = useCallback(async (): Promise<ArtifactDeliveryResult> => {
		const ids = recoveryRootIds
		if (!ids) return { kind: 'failed', message: 'There are no sent comments to resolve.' }
		if (pendingRef.current) return { kind: 'failed', message: 'A delivery operation is already pending.' }
		pendingRef.current = true
		setPending(true)
		try {
			try {
				await resolveBatch({ artifactId, rootCommentIds: [...ids] })
				setError(null)
				setRecoveryRootIds(null)
				return { kind: 'delivered-and-resolved' } as const
			} catch {
				setError('Sent, but comments could not be resolved.')
				return { kind: 'delivered-resolution-failed', rootCommentIds: ids } as const
			}
		} finally {
			pendingRef.current = false
			setPending(false)
		}
	}, [artifactId, recoveryRootIds, resolveBatch])

	return { pending, error, recoveryRootIds, deliver, copy, resolveSentComments }
}
