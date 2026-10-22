import {
	BulkDeliveryControl,
	exportFeedbackMarkdown,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback, useState } from 'react'

export function ArtifactBulkDelivery({
	artifactId,
	fileName,
	threads,
}: {
	artifactId: string
	fileName: string
	threads: readonly ProjectedCommentThread[]
}) {
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const copy = useCallback(async () => {
		if (pending) return
		setPending(true)
		setError(null)
		try {
			const feedback = exportFeedbackMarkdown({ artifactId, fileName }, threads)
			await navigator.clipboard.writeText(feedback.markdown)
		} catch {
			setError('Feedback could not be copied.')
		} finally {
			setPending(false)
		}
	}, [artifactId, fileName, pending, threads])

	return (
		<BulkDeliveryControl
			capability={{ kind: 'copy' }}
			mode="send-and-resolve"
			count={threads.length}
			pending={pending}
			error={error}
			onCopy={() => void copy()}
		/>
	)
}
