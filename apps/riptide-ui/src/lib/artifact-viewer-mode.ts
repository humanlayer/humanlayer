import { isMarkdownFile } from '@humanlayer/ui/lib/file-types'

export interface ArtifactCommentContext {
	taskId?: string | null
	resourceOwnerUserId?: string | null
	organizationId?: string | null
	userId?: string | null
}

export interface ArtifactViewerModeInput {
	artifactId?: string | null
	fileName?: string | null
	forceLegacyViewer: boolean
	commentContext?: ArtifactCommentContext | null
}

interface ArtifactViewerModeCapabilities {
	reviewHotkeys: boolean
	canSwitchVersion: boolean
}

export type ArtifactViewerMode =
	| (ArtifactViewerModeCapabilities & {
			kind: 'generic'
			commentDeliveryOwner: 'none'
	  })
	| (ArtifactViewerModeCapabilities & {
			kind: 'review'
			commentDeliveryOwner: 'review'
	  })
	| (ArtifactViewerModeCapabilities & {
			kind: 'review-readonly'
			commentDeliveryOwner: 'none'
	  })
	| (ArtifactViewerModeCapabilities & {
			kind: 'legacy'
			commentDeliveryOwner: 'legacy'
	  })
	| (ArtifactViewerModeCapabilities & {
			kind: 'legacy'
			commentDeliveryOwner: 'none'
	  })

export type WiredArtifactViewerMode =
	| Extract<ArtifactViewerMode, { kind: 'review' }>
	| Extract<ArtifactViewerMode, { kind: 'legacy'; commentDeliveryOwner: 'legacy' }>

export function resolveArtifactViewerMode(input: ArtifactViewerModeInput): ArtifactViewerMode {
	if (!isMarkdownFile(input.fileName ?? '')) {
		return {
			kind: 'generic',
			reviewHotkeys: false,
			canSwitchVersion: false,
			commentDeliveryOwner: 'none',
		}
	}

	const canSwitchVersion = !!input.artifactId
	const hasCommentContext =
		!!input.artifactId &&
		!!input.commentContext?.taskId &&
		!!input.commentContext.resourceOwnerUserId &&
		!!input.commentContext.organizationId &&
		!!input.commentContext.userId

	if (input.forceLegacyViewer) {
		return hasCommentContext
			? {
					kind: 'legacy',
					reviewHotkeys: false,
					canSwitchVersion,
					commentDeliveryOwner: 'legacy',
				}
			: {
					kind: 'legacy',
					reviewHotkeys: false,
					canSwitchVersion,
					commentDeliveryOwner: 'none',
				}
	}

	return hasCommentContext
		? {
				kind: 'review',
				reviewHotkeys: true,
				canSwitchVersion,
				commentDeliveryOwner: 'review',
			}
		: {
				kind: 'review-readonly',
				reviewHotkeys: false,
				canSwitchVersion,
				commentDeliveryOwner: 'none',
			}
}
