import type { ArtifactDeliveryMode, ArtifactDeliveryResult } from '@humanlayer/ui/artifact-viewer-v2'

import type { SessionEditorDeliveryCapture } from '@/components/diffs/delivery/session-editor-delivery-port'

import type { ExportedDiffFeedback } from './export-diff-feedback'

export type DiffFeedbackDeliveryAcceptance =
	| { readonly kind: 'queued'; readonly transactionId: string }
	| { readonly kind: 'continued'; readonly transactionId: string }
	| { readonly kind: 'rejected'; readonly reason: string }

export async function executeDiffFeedbackDelivery({
	intent,
	mode,
	feedback,
	editorCapture,
	dispatch,
	confirm,
	clearEditorIfUnchanged,
	resolveBatch,
}: {
	intent: 'send' | 'queue'
	mode: ArtifactDeliveryMode
	feedback: ExportedDiffFeedback
	editorCapture: SessionEditorDeliveryCapture
	dispatch: (intent: 'send' | 'queue', text: string) => Promise<DiffFeedbackDeliveryAcceptance>
	confirm: (acceptance: Exclude<DiffFeedbackDeliveryAcceptance, { kind: 'rejected' }>) => Promise<void>
	clearEditorIfUnchanged: (captureId: string) => void
	resolveBatch: (rootCommentIds: readonly string[]) => Promise<void>
}): Promise<ArtifactDeliveryResult> {
	try {
		const acceptance = await dispatch(intent, feedback.text)
		if (acceptance.kind === 'rejected') {
			return { kind: 'failed', message: `Delivery rejected: ${acceptance.reason}` }
		}
		await confirm(acceptance)
		clearEditorIfUnchanged(editorCapture.id)
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
