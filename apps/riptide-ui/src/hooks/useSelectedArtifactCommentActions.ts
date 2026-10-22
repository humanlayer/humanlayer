import { formatAllThreadsForLlm, RESOLVED_COMMENTS_NOTE } from '@humanlayer/ui/lib/comment-utils'
import { useCallback, useMemo } from 'react'

import { useSessionInputStore } from '@/hooks/stores/sessionInputStore'
import { useCommentActions } from '@/hooks/useCommentActions'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSelectedArtifactComments } from '@/hooks/useSelectedArtifactComments'

export interface SelectedArtifactCommentActionsResult {
	artifactFilename: string | null
	/** Whether there are comments that can be sent */
	canSendAll: boolean
	/** Number of unresolved comment threads */
	unresolvedCount: number
	/** Get formatted comments text (without resolved note) */
	getFormattedComments: () => string | null
	/** Get formatted comments text with resolved note */
	getFormattedCommentsWithResolvedNote: () => string | null
	/** Resolve all comments for the selected artifact */
	resolveAllComments: () => void
	/** Append formatted comments to editor (for command palette) */
	sendAll: () => void
	/** Append formatted comments to editor and resolve (for command palette) */
	sendAllAndResolve: () => void
}

/**
 * Autonomous bulk actions for the artifact selected in artifactViewerStore.
 * Thread/new-comment mutation surfaces use useCommentActions instead.
 */
export function useSelectedArtifactCommentActions(): SelectedArtifactCommentActionsResult {
	const { unresolvedThreads, artifactFilename, artifactId } = useSelectedArtifactComments()
	const appendToEditor = useSessionInputStore((s) => s.appendToEditor)
	const { membersMap } = useOrgMembers()
	const { resolveAllComments: resolveAllCommentsForArtifact } = useCommentActions()

	// Build user lookup map for comment formatting
	const userLookup = useMemo(() => {
		const map = new Map<string, { displayName?: string }>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
			})
		}
		return map
	}, [membersMap])

	const getFormattedComments = useCallback(() => {
		if (unresolvedThreads.length === 0) return null
		return formatAllThreadsForLlm({
			threads: unresolvedThreads,
			artifactFilename: artifactFilename ?? undefined,
			userLookup,
		})
	}, [unresolvedThreads, artifactFilename, userLookup])

	const getFormattedCommentsWithResolvedNote = useCallback(() => {
		const formatted = getFormattedComments()
		if (!formatted) return null
		return formatted.replace('</comments>', `\n\n${RESOLVED_COMMENTS_NOTE}\n</comments>`)
	}, [getFormattedComments])

	const resolveAllComments = useCallback(() => {
		if (!artifactId || unresolvedThreads.length === 0) return
		resolveAllCommentsForArtifact(artifactId)
	}, [artifactId, unresolvedThreads.length, resolveAllCommentsForArtifact])

	// Legacy functions that append to editor (for command palette)
	const sendAll = useCallback(() => {
		const formatted = getFormattedComments()
		if (!formatted || !appendToEditor) return
		appendToEditor(formatted)
	}, [getFormattedComments, appendToEditor])

	const sendAllAndResolve = useCallback(() => {
		const formatted = getFormattedCommentsWithResolvedNote()
		if (!formatted || !appendToEditor) return
		appendToEditor(formatted)
		resolveAllComments()
	}, [getFormattedCommentsWithResolvedNote, appendToEditor, resolveAllComments])

	return {
		artifactFilename,
		canSendAll: unresolvedThreads.length > 0,
		unresolvedCount: unresolvedThreads.length,
		getFormattedComments,
		getFormattedCommentsWithResolvedNote,
		resolveAllComments,
		sendAll,
		sendAllAndResolve,
	}
}
