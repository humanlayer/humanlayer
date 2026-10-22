import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { parseAnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { partitionCommentRowsByRootFormat } from '@humanlayer/ui/lib/artifact-comment-format'
import { formatAllThreadsForLlm, RESOLVED_COMMENTS_NOTE } from '@humanlayer/ui/lib/comment-utils'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useCallback, useMemo } from 'react'

import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'
import { isThreadUnread, useCommentSeenStore } from '@/mobile/hooks/commentSeenStore'
import { useRiptideApi } from '@/orpc/client'

export interface MobileTaskCommentsResult {
	/** Unresolved V2 threads across every artifact of the task. */
	unresolvedCount: number
	/** Threads with agent/teammate activity the user hasn't viewed yet. */
	unreadCount: number
	/** Artifacts with at least one unread thread. */
	unreadArtifactIds: ReadonlySet<string>
	/** LLM-formatted unresolved threads grouped per artifact, with the resolved
	 * note appended (the send flow resolves them in the same action). Null when
	 * there is nothing to send. */
	getFormattedCommentsWithResolvedNote: () => string | null
	/** Resolve all unresolved comments on every artifact that has any. */
	resolveAll: () => void
}

/**
 * Mobile analog of desktop's useSelectedArtifactCommentActions, but scoped to ALL artifacts of
 * a task instead of the currently selected one — mobile has no persistent
 * artifact selection, so "send comments" processes everything at once.
 */
export function useMobileTaskComments(taskId: string | null | undefined): MobileTaskCommentsResult {
	const { artifactCommentsCollection, artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	const { membersMap } = useOrgMembers()
	const { userId } = useUserInfo()
	const lastSeenByThread = useCommentSeenStore((s) => s.lastSeenByThread)

	const commentsQuery = useLiveQuery(
		(q) =>
			taskId
				? q.from({ comments: artifactCommentsCollection }).where(({ comments }) => eq(comments.task_id, taskId))
				: undefined,
		[artifactCommentsCollection, taskId],
	)
	const comments = (commentsQuery.data ?? []) as ArtifactComment[]
	const v2Comments = useMemo(() => partitionCommentRowsByRootFormat(comments).v2, [comments])

	const artifactsQuery = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, false)))
						.select(({ artifacts }) => ({ id: artifacts.id, file_name: artifacts.file_name }))
				: undefined,
		[artifactsMetadataCollection, taskId],
	)
	const filenameByArtifactId = useMemo(() => {
		const map = new Map<string, string>()
		for (const artifact of artifactsQuery.data ?? []) map.set(artifact.id, artifact.file_name)
		return map
	}, [artifactsQuery.data])

	const userLookup = useMemo(() => {
		const map = new Map<string, { displayName?: string }>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
			})
		}
		return map
	}, [membersMap])

	// Unresolved threads grouped by artifact (same thread shape as desktop's
	// useSelectedArtifactComments, computed for every artifact at once).
	const threadsByArtifactId = useMemo(() => {
		const byId = new Map(v2Comments.map((comment) => [comment.id, comment]))
		const active = v2Comments.filter((comment) => !comment.is_deleted)
		const repliesByRoot = new Map<string, ArtifactComment[]>()
		for (const comment of active) {
			if (!comment.reply_to_comment_id) continue
			const rootId = mobileThreadRootId(comment, byId)
			if (!rootId) continue
			const replies = repliesByRoot.get(rootId)
			if (replies) replies.push(comment)
			else repliesByRoot.set(rootId, [comment])
		}
		const roots = active
			.filter((comment) => !comment.reply_to_comment_id && !comment.is_resolved)
			.sort(compareComments)

		const groups = new Map<string, Parameters<typeof formatAllThreadsForLlm>[0]['threads']>()
		for (const root of roots) {
			const replies = (repliesByRoot.get(root.id) ?? []).sort(compareComments)
			const anchor = parseAnchorV2(root.anchor_json)
			const thread = {
				markdownContext: anchor
					? {
							previousMarkdown: anchor.start.previousBlockText,
							currentMarkdown: anchor.selectedText,
							nextMarkdown: anchor.end.nextBlockText,
						}
					: null,
				rootComment: {
					id: root.id,
					contentText: root.content_text,
					isResolved: root.is_resolved,
					createdByUserId: root.created_by_user_id,
				},
				replies: replies.map((reply) => ({
					id: reply.id,
					contentText: reply.content_text,
					isResolved: reply.is_resolved,
					createdByUserId: reply.created_by_user_id,
				})),
			}
			const group = groups.get(root.artifact_id)
			if (group) group.push(thread)
			else groups.set(root.artifact_id, [thread])
		}
		return groups
	}, [v2Comments])

	const getFormattedCommentsWithResolvedNote = useCallback(() => {
		if (threadsByArtifactId.size === 0) return null
		// The resolved note goes INSIDE each <comments> block, matching the shape
		// desktop's useSelectedArtifactCommentActions produces for its single-artifact block.
		const blocks = [...threadsByArtifactId.entries()].map(([artifactId, threads]) =>
			formatAllThreadsForLlm({
				artifactFilename: filenameByArtifactId.get(artifactId),
				threads,
				userLookup,
			}).replace('</comments>', `\n\n${RESOLVED_COMMENTS_NOTE}\n</comments>`),
		)
		return blocks.join('\n\n')
	}, [threadsByArtifactId, filenameByArtifactId, userLookup])

	const resolveAll = useCallback(() => {
		for (const [artifactId, threads] of threadsByArtifactId) {
			const rootCommentIds = threads
				.map((thread) => thread.rootComment.id)
				.filter((id): id is string => id != null)
			if (rootCommentIds.length === 0) continue
			void client.comments
				.resolveBatch({ artifactId, rootCommentIds })
				.then((response) => confirmTx.artifactComments(response.transactionId))
		}
	}, [client.comments, confirmTx.artifactComments, threadsByArtifactId])

	// Resolved comments do not contribute to unread state, but a new unresolved
	// reply can surface activity on a previously resolved thread.
	const { unreadCount, unreadArtifactIds } = useMemo(() => {
		const active = v2Comments.filter((comment) => !comment.is_deleted)
		const byId = new Map(v2Comments.map((comment) => [comment.id, comment]))
		const roots = active.filter((comment) => !comment.reply_to_comment_id)
		const artifactIds = new Set<string>()
		let count = 0
		for (const root of roots) {
			const replies = active.filter((comment) => mobileThreadRootId(comment, byId) === root.id)
			if (isThreadUnread(lastSeenByThread, userId, root, replies)) {
				count++
				artifactIds.add(root.artifact_id)
			}
		}
		return { unreadCount: count, unreadArtifactIds: artifactIds }
	}, [lastSeenByThread, userId, v2Comments])

	return {
		unresolvedCount: [...threadsByArtifactId.values()].reduce((count, threads) => count + threads.length, 0),
		unreadCount,
		unreadArtifactIds,
		getFormattedCommentsWithResolvedNote,
		resolveAll,
	}
}

function compareComments(a: ArtifactComment, b: ArtifactComment): number {
	return Number(a.created_at - b.created_at) || a.id.localeCompare(b.id)
}

function mobileThreadRootId(row: ArtifactComment, byId: ReadonlyMap<string, ArtifactComment>): string | null {
	let current = row
	const seen = new Set([row.id])
	while (current.reply_to_comment_id) {
		const parent = byId.get(current.reply_to_comment_id)
		if (!parent || seen.has(parent.id)) return null
		seen.add(parent.id)
		current = parent
	}
	return current.id === row.id ? null : current.id
}
