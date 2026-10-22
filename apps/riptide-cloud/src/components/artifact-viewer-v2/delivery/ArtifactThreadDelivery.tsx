import {
	exportThreadFeedbackMarkdown,
	ThreadDeliveryControl,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback, useState } from 'react'

/**
 * Cloud per-thread delivery leaf: Cloud has no session-launch/delivery
 * integration, so the thread control is explicitly copy-only — one Copy for
 * Agent action per open root thread, copying the root plus all its replies
 * (never siblings), with no Copy & Resolve variant and never resolving.
 */
export function ArtifactThreadDelivery({
	artifactId,
	fileName,
	thread,
}: {
	artifactId: string
	fileName: string
	thread: ProjectedCommentThread
}) {
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const copy = useCallback(async () => {
		if (pending) return
		setPending(true)
		setError(null)
		try {
			const feedback = exportThreadFeedbackMarkdown({ artifactId, fileName }, thread)
			if (!feedback) {
				setError('This thread is already resolved.')
				return
			}
			await navigator.clipboard.writeText(feedback.markdown)
		} catch {
			setError('Feedback could not be copied.')
		} finally {
			setPending(false)
		}
	}, [artifactId, fileName, pending, thread])

	return (
		<ThreadDeliveryControl
			capability={{ kind: 'copy' }}
			pending={pending}
			error={error}
			onCopy={() => void copy()}
		/>
	)
}
