import type { Task } from '@humanlayer/db/tables/tasks'
import { type DiffReviewComparison, getComparisonDiff } from '@humanlayer/ui/lib/diff-review/build-code-view-items'
import { buildDiffCommentSelectedDiff } from '@humanlayer/ui/lib/diff-review/diff-comment-excerpt'
import { exportDiffComments } from '@humanlayer/ui/lib/diff-review/export-diff-comments'
import {
	type ProjectableDiffComment,
	type ProjectableDiffFile,
	type ProjectedDiffThread,
	projectDiffComments,
} from '@humanlayer/ui/lib/diff-review/project-diff-comments'
import { useMemo } from 'react'
import { uuidv7 } from 'uuidv7'

import { createDiffCommentActions } from '@/actions/diff-comments'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useTaskDiffComments } from '@/hooks/diffs/useTaskDiffComments'
import { useUserInfo } from '@/hooks/useUserInfo'
import { basename } from '@/minimalist/lib/format'
import type { CommentPerson } from '@/minimalist/lib/people'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

export type DiffThread = ProjectedDiffThread

/** Where a new comment goes: one line of one file, in the comparison on screen. */
export type LineTarget = {
	file: { repoId: string; path: string; versionId?: string }
	comparison: DiffReviewComparison
	side: 'old' | 'new'
	line: number
}

/**
 * A task's saved diff comments, open ones only, placed on the diff as it is now.
 * Teammates see the same threads, and the agent can read them with its diff comment tool.
 */
export function useDiffThreads(
	taskId: string,
	files: readonly ProjectableDiffFile[],
	comparisons: readonly DiffReviewComparison[],
): { threads: DiffThread[]; loading: boolean } {
	const comments = useTaskDiffComments(taskId)
	const threads = useMemo(
		() =>
			projectDiffComments({ comments: comments.rows, files, comparisons }).threads.filter(
				(thread) => !thread.root.is_resolved && !thread.root.is_deleted,
			),
		[comments.rows, files, comparisons],
	)
	return { threads, loading: comments.isLoading }
}

/** The thread a comment belongs to, by the root's ID or a reply's, as links name either. */
export function threadOf(threads: readonly DiffThread[], commentId: string): DiffThread | undefined {
	return threads.find(
		(thread) => thread.root.id === commentId || thread.replies.some((reply) => reply.id === commentId),
	)
}

/** The diff file a thread sits in, when it sits in one the diff still shows. */
export function threadFileId(thread: DiffThread): string | undefined {
	return 'fileId' in thread.placement ? thread.placement.fileId : undefined
}

/** Threads on a line of a file, current or from an earlier version of it that still has the line, with that line. */
export function lineThreads(threads: readonly DiffThread[], fileId: string) {
	const placed: Array<{ thread: DiffThread; side: 'old' | 'new'; line: number }> = []
	for (const thread of threads) {
		const placement = thread.placement
		if (placement.status !== 'current' && placement.status !== 'outdated-inline') continue
		if (placement.fileId === fileId) placed.push({ thread, side: placement.side, line: placement.line })
	}
	return placed
}

/** Threads on a file whose line is gone or not loaded yet; they show above the file's diff. */
export function fileThreads(threads: readonly DiffThread[], fileId: string) {
	return threads.filter(
		(thread) =>
			(thread.placement.status === 'outdated-file' || thread.placement.status === 'pending') &&
			thread.placement.fileId === fileId,
	)
}

/** Where a thread sits when it isn't on a line of the current diff. Null when it is. */
export function threadPlace(thread: DiffThread): string | null {
	const line = thread.root.anchor_json?.start.line
	const at = line ? `Line ${line}` : null
	switch (thread.placement.status) {
		case 'current':
			return null
		case 'outdated-inline':
			return 'Outdated'
		case 'outdated-file':
			return at ? `${at} · outdated` : 'Outdated'
		case 'pending':
			return at
		case 'file-missing':
			return line ? `${thread.placement.path}:${line}` : thread.placement.path
	}
}

/** A diff comment's author with their picture, for its byline. */
export function authorPerson(comment: ProjectableDiffComment): CommentPerson {
	const name =
		[comment.author?.firstName, comment.author?.lastName].filter(Boolean).join(' ') ||
		comment.author?.email ||
		'A teammate'
	return { name, src: comment.author?.profilePictureUrl, agent: comment.created_by_agent }
}

/** Add, delete and resolve diff comments. Saves optimistically; only failures speak up. */
export function useDiffCommentWrites(task: Pick<Task, 'id' | 'resource_owner_user_id'>) {
	const { client } = useRiptideApi()
	const { diffCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const { showToast } = useUi()
	const actions = createDiffCommentActions(
		// Electric and query collections expose the same mutation surface.
		diffCommentsCollection as Parameters<typeof createDiffCommentActions>[0],
		{ diffComments: client.diffComments },
		confirmTx.diffComments,
	)

	/** Resolves to whether the comment saved. */
	const add = async (target: LineTarget, text: string): Promise<boolean> => {
		if (!dbOrganizationId || !userId || !target.file.versionId) {
			showToast('Could not add the comment. The diff for this file is still loading.')
			return false
		}
		const point = { side: target.side, line: target.line }
		const diff = getComparisonDiff(target.comparison)
		try {
			await actions.create({
				id: uuidv7(),
				taskId: task.id,
				contentText: text,
				anchor: {
					v: 1,
					repoId: target.file.repoId,
					path: target.file.path,
					// The anchor's names predate whole file versions: patchHash is the right side's version.
					patchHash: target.file.versionId,
					sourceVersionId: target.comparison.sourceVersionId,
					// The line as you saw it, for the agent; the file may change before it reads the comment.
					selectedDiff: diff ? buildDiffCommentSelectedDiff(diff, { start: point, end: point }) : undefined,
					start: point,
					end: point,
				},
				organizationId: dbOrganizationId,
				createdByUserId: userId,
				resourceOwnerUserId: task.resource_owner_user_id,
			}).isPersisted.promise
			return true
		} catch {
			showToast('Could not add the comment. Your text is kept; open the line again to retry.')
			return false
		}
	}

	const remove = async (commentId: string) => {
		try {
			await actions.remove({ commentId }).isPersisted.promise
		} catch {
			showToast('Could not delete the comment. Try again.')
		}
	}

	// The server records who resolved it; the user ID only fills in the optimistic row.
	const resolve = async (rootCommentIds: readonly string[]) => {
		if (rootCommentIds.length === 0) return
		try {
			await actions.resolveBatch({
				taskId: task.id,
				rootCommentIds: [...rootCommentIds],
				resolvedByUserId: userId ?? '',
			}).isPersisted.promise
		} catch {
			showToast('Could not resolve the comments. They are still open. Try again.')
		}
	}

	return { add, remove, resolve, userId }
}

/** What "Send to the agent" posts for open threads, and which threads to resolve once it lands. */
export function diffCommentsMessage(threads: readonly DiffThread[]) {
	const { xml, rootCommentIds } = exportDiffComments(threads)
	return { text: xml, rootCommentIds }
}

/**
 * Reads back a message built by `diffCommentsMessage`, so the thread shows
 * "2 comments on app.ts" rather than the XML the agent receives.
 */
export function parseDiffCommentMessage(
	text: string,
): { file: string | null; comments: Array<{ quote: string; lines: string[] }> } | null {
	const body = text.trim().match(/^<diff_comments>\n([\s\S]*)\n<\/diff_comments>$/)?.[1]
	if (body === undefined) return null
	const comments = [
		...body.matchAll(
			/<diff_comment [^>]*path="([^"]*)" start_line="(\d+)"[^>]*>\n([\s\S]*?)\n\s*<\/diff_comment>/g,
		),
	].map((match) => ({
		path: unescapeXml(match[1] ?? ''),
		quote: `${unescapeXml(match[1] ?? '')}:${match[2]}`,
		// The selected lines are for the agent; the thread shows only what people wrote.
		lines: (match[3] ?? '')
			.replace(/<selected_diff>[\s\S]*?<\/selected_diff>/, '')
			.split('\n')
			.map((line) => unescapeXml(line.trim()))
			.filter((line) => line && line !== 'read the current file before acting'),
	}))
	if (comments.length === 0) return null
	const paths = new Set(comments.map((comment) => comment.path))
	const [only] = paths
	return {
		file: paths.size === 1 && only ? basename(only) : null,
		comments: comments.map(({ quote, lines }) => ({ quote, lines })),
	}
}

function unescapeXml(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&amp;', '&')
}
