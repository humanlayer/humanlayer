import { parseTaskDiffFileId } from '@humanlayer/streams/diff'
import type { CodeViewScrollTarget } from '@pierre/diffs'

import type { TaskDiffComment } from './useTaskDiffComments'
import type { TaskDiffFilesResult } from './useTaskDiffFiles'

export type DiffDeepLinkPresentation = 'sidebar' | 'primary' | 'fullscreen'

export interface TaskDiffDeepLinkSearch {
	readonly diffFileId: string | null
	readonly diffCommentId: string | null
	readonly diffPresentation: DiffDeepLinkPresentation | null
}

interface TaskDiffDeepLinkBase {
	readonly presentation: DiffDeepLinkPresentation
	readonly requestedFileId: string | null
	readonly requestedCommentId: string | null
}

export type TaskDiffDeepLinkTarget =
	| ({ readonly status: 'pending' } & TaskDiffDeepLinkBase)
	| ({
			readonly status: 'ready'
			readonly fileId: string | null
			readonly rootCommentId: string | null
			readonly scrollTarget: CodeViewScrollTarget | null
	  } & TaskDiffDeepLinkBase)
	| ({
			readonly status: 'missing-file'
			readonly fileId: string
			readonly repoId: string | null
			readonly path: string | null
	  } & TaskDiffDeepLinkBase)
	| ({ readonly status: 'missing-comment'; readonly commentId: string } & TaskDiffDeepLinkBase)

interface UseTaskDiffDeepLinkTargetInput extends TaskDiffDeepLinkSearch {
	readonly taskId: string
	readonly files: TaskDiffFilesResult
	readonly comments: { readonly rows: readonly TaskDiffComment[]; readonly isLoading: boolean }
}

function findThreadRootForComment(
	comments: readonly TaskDiffComment[],
	commentId: string,
): TaskDiffComment | undefined {
	const comment = comments.find((row) => row.id === commentId)
	if (!comment) return undefined
	return comment.reply_to_comment_id ? comments.find((row) => row.id === comment.reply_to_comment_id) : comment
}

function hasVisibleThreadContent(comments: readonly TaskDiffComment[], root: TaskDiffComment): boolean {
	return !root.is_deleted || comments.some((row) => row.reply_to_comment_id === root.id && !row.is_deleted)
}

/**
 * Resolves the diff file ID to navigate to, given the explicit file ID from the
 * URL (if any) or the anchor embedded in the comment thread root.
 */
function resolveFileId(
	diffFileId: string | null,
	threadRoot: TaskDiffComment | undefined,
	files: TaskDiffFilesResult,
	taskId: string,
): string | undefined {
	if (diffFileId) return diffFileId
	if (!threadRoot?.anchor_json) return undefined
	const anchor = threadRoot.anchor_json
	const found = files.rows.find(
		(file) => file.repoId === anchor.repoId && (file.path === anchor.path || file.prevPath === anchor.path),
	)
	return found?.id ?? `${taskId}:${anchor.repoId}:${anchor.path}`
}

/** Builds the code-view scroll target for the resolved file and anchor. */
function buildScrollTarget(
	fileId: string | undefined,
	threadRoot: TaskDiffComment | undefined,
): CodeViewScrollTarget | null {
	if (!fileId) return null
	if (!threadRoot?.anchor_json) return { type: 'item', id: fileId, align: 'start', behavior: 'instant' }
	const anchor = threadRoot.anchor_json
	return {
		type: 'line',
		id: fileId,
		lineNumber: anchor.end.line,
		side: anchor.end.side === 'old' ? 'deletions' : 'additions',
		align: 'nearest',
		behavior: 'instant',
	}
}

/**
 * Resolves the loaded-data portion of a diff deep-link: comment / file
 * existence checks, file-id resolution, and scroll-target construction.
 * Called only when both `files` and `comments` have finished loading.
 */
function resolveLoadedTarget(
	base: TaskDiffDeepLinkBase,
	diffFileId: string | null,
	diffCommentId: string | null,
	files: TaskDiffFilesResult,
	comments: readonly TaskDiffComment[],
	taskId: string,
): TaskDiffDeepLinkTarget {
	const threadRoot = diffCommentId ? findThreadRootForComment(comments, diffCommentId) : undefined
	if (diffCommentId && (!threadRoot || !hasVisibleThreadContent(comments, threadRoot))) {
		return { ...base, status: 'missing-comment', commentId: diffCommentId }
	}

	const fileId = resolveFileId(diffFileId, threadRoot, files, taskId)
	if (fileId && !files.rows.some((file) => file.id === fileId)) {
		const parsed = parseTaskDiffFileId(fileId)
		return {
			...base,
			status: 'missing-file',
			fileId,
			repoId: parsed ? String(parsed.repoId) : (threadRoot?.anchor_json?.repoId ?? null),
			path: parsed?.path ?? threadRoot?.anchor_json?.path ?? null,
		}
	}

	return {
		...base,
		status: 'ready',
		fileId: fileId ?? null,
		rootCommentId: threadRoot?.id ?? null,
		scrollTarget: buildScrollTarget(fileId, threadRoot),
	}
}

/**
 * Resolves a diff URL into a renderable navigation target.
 *
 * The result stays pending until both synchronized inputs finish their initial load, so an absent row is not
 * mistaken for a deleted file or comment. Live-query updates naturally rerender the caller without an effect.
 */
export function useTaskDiffDeepLinkTarget({
	taskId,
	files,
	comments,
	diffFileId,
	diffCommentId,
	diffPresentation,
}: UseTaskDiffDeepLinkTargetInput): TaskDiffDeepLinkTarget | null {
	if (!diffFileId && !diffCommentId && !diffPresentation) return null
	const base: TaskDiffDeepLinkBase = {
		presentation: diffPresentation ?? 'sidebar',
		requestedFileId: diffFileId,
		requestedCommentId: diffCommentId,
	}
	if (files.status === 'loading' || comments.isLoading) return { ...base, status: 'pending' }
	return resolveLoadedTarget(base, diffFileId, diffCommentId, files, comments.rows, taskId)
}
