import type {
	ArtifactDeliveryCapability,
	ArtifactDeliveryMode,
	ArtifactDeliveryResult,
	ExportedArtifactFeedback,
} from '@humanlayer/ui/artifact-viewer-v2'
import { RESOLVED_COMMENTS_NOTE } from '@humanlayer/ui/lib/comment-utils'

export type DeliveryAcceptance =
	| { kind: 'queued'; transactionId: string }
	| { kind: 'continued'; transactionId: string }
	| { kind: 'rejected'; reason: string }

function appendResolvedCommentsNote(markdown: string): string {
	const closingTagIndex = markdown.lastIndexOf('</comments>')
	if (closingTagIndex === -1) return `${markdown}\n${RESOLVED_COMMENTS_NOTE}`
	return `${markdown.slice(0, closingTagIndex)}${RESOLVED_COMMENTS_NOTE}\n${markdown.slice(closingTagIndex)}`
}

export function formatFeedbackForDelivery(markdown: string, mode: ArtifactDeliveryMode): string {
	return mode === 'send-and-resolve' ? appendResolvedCommentsNote(markdown) : markdown
}

export async function executeBulkArtifactDelivery({
	capability,
	mode,
	feedback,
	dispatch,
	confirm,
	resolveBatch,
}: {
	capability: Extract<ArtifactDeliveryCapability, { kind: 'send' | 'queue' }>
	mode: ArtifactDeliveryMode
	feedback: ExportedArtifactFeedback
	dispatch: (intent: 'send' | 'queue', markdown: string) => Promise<DeliveryAcceptance>
	confirm: (acceptance: Exclude<DeliveryAcceptance, { kind: 'rejected' }>) => Promise<void>
	resolveBatch: (rootCommentIds: readonly string[]) => Promise<void>
}): Promise<ArtifactDeliveryResult> {
	const markdown = formatFeedbackForDelivery(feedback.markdown, mode)
	try {
		const acceptance = await dispatch(capability.kind === 'queue' ? 'queue' : 'send', markdown)
		if (acceptance.kind === 'rejected') {
			return { kind: 'failed', message: `Delivery rejected: ${acceptance.reason}` }
		}
		await confirm(acceptance)
	} catch {
		return { kind: 'failed', message: 'Feedback could not be delivered.' }
	}

	if (mode === 'send') return { kind: 'delivered' }
	try {
		await resolveBatch(feedback.rootCommentIds)
		return { kind: 'delivered-and-resolved' }
	} catch {
		return { kind: 'delivered-resolution-failed', rootCommentIds: feedback.rootCommentIds }
	}
}
