import { formatAllThreadsForLlm, type MarkdownBlockContext } from '../../lib/comment-utils'

import { parseAnchorV2 } from '../anchor/resolve'
import type { ProjectedCommentThread } from '../comments/project-comments'

export interface ArtifactFeedbackIdentity {
  artifactId: string
  fileName: string
}

export interface ExportedArtifactFeedback {
  markdown: string
  rootCommentIds: readonly string[]
}

function markdownContextForThread(thread: ProjectedCommentThread): MarkdownBlockContext | null {
	const anchor = parseAnchorV2(thread.root.anchor_json)
	if (!anchor) return null

	return {
		previousMarkdown: anchor.start.previousBlockText,
		currentMarkdown: anchor.selectedText,
		nextMarkdown: anchor.end.nextBlockText,
	}
}

/**
 * Format ONE open root thread — the root plus every reply, never sibling
 * threads — for per-thread agent delivery. It shares the exact bulk grammar
 * (one `<comments for="filename">` envelope around one `<comment>` block).
 * Returns `null` at the action boundary when the root is already resolved or
 * deleted: per-thread delivery never formats a resolved thread.
 */
export function exportThreadFeedbackMarkdown(
	identity: ArtifactFeedbackIdentity,
	thread: ProjectedCommentThread,
): ExportedArtifactFeedback | null {
	if (thread.root.is_deleted || thread.root.is_resolved) return null
	return exportFeedbackMarkdown(identity, [thread])
}

/** Format the controller's authoritative open-thread projection for agent delivery. */
export function exportFeedbackMarkdown(
	identity: ArtifactFeedbackIdentity,
	threads: readonly ProjectedCommentThread[],
): ExportedArtifactFeedback {
	const openThreads = threads.filter((thread) => !thread.root.is_deleted && !thread.root.is_resolved)
	const userLookup = new Map<string, { displayName: string }>()
	for (const thread of openThreads) {
		const rootAuthorId = thread.root.created_by_user_id ?? thread.root.anonymous_author_id ?? thread.root.id
		userLookup.set(rootAuthorId, { displayName: thread.authorName })
		for (const reply of thread.replies) {
			userLookup.set(reply.createdByUserId, { displayName: reply.authorName })
		}
	}

	return {
		rootCommentIds: openThreads.map((thread) => thread.root.id),
		markdown: formatAllThreadsForLlm({
			artifactFilename: identity.fileName,
			threads: openThreads.map((thread) => ({
				markdownContext: markdownContextForThread(thread),
				rootComment: {
					id: thread.root.id,
					contentText: thread.root.content_text,
					createdByUserId: thread.root.created_by_user_id ?? thread.root.anonymous_author_id ?? thread.root.id,
				},
				replies: thread.replies.map((reply) => ({
					id: reply.id,
					contentText: reply.contentText,
					createdByUserId: reply.createdByUserId,
				})),
			})),
			userLookup,
		}),
	}
}
