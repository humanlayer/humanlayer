import { BlockCommentComposer, type AnchorV2, type BlockCommentSubmission } from '@humanlayer/ui/artifact-viewer-v2'

export interface ArtifactCommentComposerProps {
	artifactId: string
	composer: { anchor: AnchorV2; rect: DOMRect } | null
	submitComment: (submission: BlockCommentSubmission) => Promise<boolean>
	closeComposer: () => void
	dismissTarget: () => void
	submitVerdict: (kind: 'deletion' | 'approval') => void
	currentUserDisplayName: string | undefined
	currentUserAvatarUrl: string | undefined
}

/**
 * Binds the controller's composer target (keyboard `c` on the focused block, a
 * click on an uncommented block, or a precise range) to the shared composer.
 * Submission flows through the controller's V2-owned optimistic action, which
 * sends `anchorJson` without any legacy triplet fields. Receives the view-model
 * fields as props (one-hop) from the Wired `ArtifactViewerV2`.
 */
export function ArtifactCommentComposer({
	artifactId,
	composer,
	submitComment,
	closeComposer,
	dismissTarget,
	submitVerdict,
	currentUserDisplayName,
	currentUserAvatarUrl,
}: ArtifactCommentComposerProps) {
	if (!composer) return null
	return (
		<BlockCommentComposer
			artifactId={artifactId}
			anchor={composer.anchor}
			blockRect={composer.rect}
			onSubmit={submitComment}
			onCloseComposer={closeComposer}
			onDismissTarget={dismissTarget}
			onSubmitVerdict={submitVerdict}
			currentUserDisplayName={currentUserDisplayName}
			currentUserAvatarUrl={currentUserAvatarUrl}
		/>
	)
}
