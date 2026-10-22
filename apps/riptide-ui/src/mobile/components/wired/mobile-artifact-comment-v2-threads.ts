import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	parseAnchorV2,
	projectArtifactComments,
	type AnchorPlacement,
	type ArtifactCommentProjection,
	type CommentProjectionIdentity,
	type ProjectedCommentThread,
	type ProseMirrorNode,
} from '@humanlayer/ui/artifact-viewer-v2'

export interface MobileArtifactCommentV2Thread {
	root: ArtifactComment
	replies: ArtifactComment[]
	placement: AnchorPlacement
	anchorText: string
	isResolved: boolean
	isOutdated: boolean
}

export interface MobileArtifactCommentV2Projection {
	projection: ArtifactCommentProjection
	threads: MobileArtifactCommentV2Thread[]
}

export function toMobileArtifactCommentV2Thread(
	thread: ProjectedCommentThread,
	commentById: ReadonlyMap<string, ArtifactComment>,
): MobileArtifactCommentV2Thread {
	// Mobile callers project authenticated comments, so the projected root retains
	// the complete row at runtime. Prefer the source map when it is available while
	// preserving the standalone adapter contract used by tests and other callers.
	const root = commentById.get(thread.root.id) ?? (thread.root as ArtifactComment)
	const anchor = parseAnchorV2(thread.root.anchor_json)
	const anchorText = anchor?.selectedText || (anchor ? `[${anchor.start.blockType}]` : 'Unknown section')
	return {
		root,
		replies: thread.replies
			.map((reply) => commentById.get(reply.id))
			.filter((reply): reply is ArtifactComment => reply != null),
		placement: thread.placement,
		anchorText,
		isResolved: thread.root.is_resolved,
		isOutdated: thread.placement.status === 'outdated',
	}
}

export function projectMobileArtifactCommentV2Threads(
	comments: ArtifactComment[],
	doc: ProseMirrorNode,
	identities: ReadonlyMap<string, CommentProjectionIdentity>,
): MobileArtifactCommentV2Projection {
	const projection = projectArtifactComments(comments, doc, identities)
	const commentById = new Map(comments.map((comment) => [comment.id, comment]))
	return {
		projection,
		threads: [...projection.threads, ...projection.resolvedThreads].map((thread) =>
			toMobileArtifactCommentV2Thread(thread, commentById),
		),
	}
}
