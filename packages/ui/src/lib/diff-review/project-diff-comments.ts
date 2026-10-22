import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import type { DiffCommentAnchor } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import type { CodeViewScrollTarget, DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'

import { getComparisonDiff, type DiffReviewComparison } from './build-code-view-items'
import { diffCommentSideToPierre } from './diff-comment-anchor'

export interface DiffCommentAuthor {
	readonly firstName?: string
	readonly lastName?: string
	readonly email: string
	readonly profilePictureUrl?: string
}

export type ProjectableDiffComment = DiffComment & {
	readonly author?: DiffCommentAuthor
}

export interface ProjectableDiffFile {
	readonly id: string
	readonly repoId: string
	readonly path: string
	readonly prevPath?: string
	/** Version on the right side of the comparison; comment anchors store it as `patchHash`. */
	readonly versionId?: string
}

export type DiffThreadPlacement =
	| { readonly status: 'current'; readonly fileId: string; readonly side: 'old' | 'new'; readonly line: number }
	| { readonly status: 'outdated-inline'; readonly fileId: string; readonly side: 'old' | 'new'; readonly line: number }
	| { readonly status: 'outdated-file'; readonly fileId: string }
	| { readonly status: 'pending'; readonly fileId: string }
	| { readonly status: 'file-missing'; readonly repoId: string; readonly path: string }

export interface ProjectedDiffThread {
	readonly root: ProjectableDiffComment
	readonly replies: readonly ProjectableDiffComment[]
	readonly placement: DiffThreadPlacement
}

export interface DiffCommentAnnotationMetadata {
	readonly kind: 'diff-comment-thread'
	readonly thread: ProjectedDiffThread
}

export interface DiffCommentFileSectionMetadata {
	readonly kind: 'diff-comment-file-section'
	readonly threads: readonly ProjectedDiffThread[]
	readonly repoId?: string
	readonly path?: string
	readonly missing: boolean
}

export interface DiffCommentComposerAnnotationMetadata {
	readonly kind: 'diff-comment-composer'
	readonly fileId: string
	readonly repoId: string
	readonly path: string
	readonly patchHash: string
	/** Left-side version on screen; missing when the left side is the file at task start. */
	readonly sourceVersionId?: string
	/** Selected rows of the comparison on screen, saved on the anchor for the agent. */
	readonly selectedDiff?: string
	readonly range: SelectedLineRange
}

export type DiffReviewAnnotationMetadata =
	| { readonly kind: 'diff-loading' }
	| DiffCommentAnnotationMetadata
	| DiffCommentFileSectionMetadata
	| DiffCommentComposerAnnotationMetadata

export interface MissingDiffCommentFile {
	readonly id: string
	readonly repoId: string
	readonly path: string
	readonly threads: readonly ProjectedDiffThread[]
	readonly openRootCount: number
}

export interface ProjectedDiffComments {
	readonly threads: readonly ProjectedDiffThread[]
	readonly annotationsByFile: ReadonlyMap<string, readonly DiffLineAnnotation<DiffCommentAnnotationMetadata>[]>
	readonly fileSections: ReadonlyMap<string, readonly ProjectedDiffThread[]>
	readonly missingFiles: readonly MissingDiffCommentFile[]
	readonly openRootCountByFile: ReadonlyMap<string, number>
	readonly openRootCount: number
}

type PierreSide = NonNullable<SelectedLineRange['side']>

interface LineInterval {
	readonly side: PierreSide
	readonly start: number
	readonly end: number
}

function selectedLineIntervals(range: SelectedLineRange): readonly LineInterval[] {
	const startSide = range.side
	if (!startSide) return []
	const endSide = range.endSide ?? startSide
	if (startSide === endSide) {
		return [{ side: startSide, start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) }]
	}
	return [
		{ side: startSide, start: range.start, end: range.start },
		{ side: endSide, start: range.end, end: range.end },
	]
}

function anchorLineIntervals(
	start: { readonly side: 'old' | 'new'; readonly line: number },
	end: { readonly side: 'old' | 'new'; readonly line: number },
): readonly LineInterval[] {
	const startSide = diffCommentSideToPierre(start.side)
	const endSide = diffCommentSideToPierre(end.side)
	if (startSide === endSide) {
		return [{ side: startSide, start: Math.min(start.line, end.line), end: Math.max(start.line, end.line) }]
	}
	return [
		{ side: startSide, start: start.line, end: start.line },
		{ side: endSide, start: end.line, end: end.line },
	]
}

export function findFirstOverlappingDiffThread(
	threads: readonly ProjectedDiffThread[],
	selection: { readonly id: string; readonly range: SelectedLineRange },
): ProjectedDiffThread | undefined {
	const selectedBySide = selectedLineIntervals(selection.range)
	return threads.find((thread) => {
		if (thread.placement.status !== 'current' && thread.placement.status !== 'outdated-inline') return false
		if (thread.placement.fileId !== selection.id) return false
		const anchor = thread.root.anchor_json
		if (!anchor) return false
		const anchoredBySide = anchorLineIntervals(anchor.start, anchor.end)
		return selectedBySide.some((selected) => anchoredBySide.some(
			(anchored) => selected.side === anchored.side && selected.start <= anchored.end && anchored.start <= selected.end,
		))
	})
}

function compareRows(left: ProjectableDiffComment, right: ProjectableDiffComment): number {
	const byTime = left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0
	return byTime || left.id.localeCompare(right.id)
}

function lineExists(comparison: DiffReviewComparison, side: 'old' | 'new', line: number): boolean | null {
	const parsed = getComparisonDiff(comparison)
	if (!parsed) return null
	return parsed.hunks.some((hunk) => {
		const start = side === 'old' ? hunk.deletionStart : hunk.additionStart
		const count = side === 'old' ? hunk.deletionCount : hunk.additionCount
		return line >= start && line < start + count
	})
}

/**
 * A comment on old-side lines names lines of the left side it was written on, so it is current
 * only while that left side is on screen. A missing `sourceVersionId` means the file at task
 * start, which is what comments saved before the field existed were written against.
 * Comments only on new-side lines do not depend on the left side.
 */
function leftSideMatches(anchor: DiffCommentAnchor, comparison: DiffReviewComparison): boolean {
	if (anchor.start.side !== 'old' && anchor.end.side !== 'old') return true
	return anchor.sourceVersionId === comparison.sourceVersionId
}

function getPlacement(
	root: ProjectableDiffComment,
	files: readonly ProjectableDiffFile[],
	comparisonsByFileId: ReadonlyMap<string, DiffReviewComparison>,
): DiffThreadPlacement {
	const anchor = root.anchor_json
	if (!anchor) return { status: 'file-missing', repoId: '', path: '' }
	const exactFile = files.find((file) => file.repoId === anchor.repoId && file.path === anchor.path)
	const renamedFile = exactFile
		? undefined
		: files.find((file) => file.repoId === anchor.repoId && file.prevPath === anchor.path)
	const file = exactFile ?? renamedFile
	if (!file) return { status: 'file-missing', repoId: anchor.repoId, path: anchor.path }
	const comparison = comparisonsByFileId.get(file.id)
	if (!comparison) return { status: 'pending', fileId: file.id }
	const exists = lineExists(comparison, anchor.end.side, anchor.end.line)
	if (exists === null) return { status: 'pending', fileId: file.id }
	if (!renamedFile && file.versionId === anchor.patchHash && leftSideMatches(anchor, comparison)) {
		return { status: 'current', fileId: file.id, side: anchor.end.side, line: anchor.end.line }
	}
	if (exists) {
		return { status: 'outdated-inline', fileId: file.id, side: anchor.end.side, line: anchor.end.line }
	}
	return { status: 'outdated-file', fileId: file.id }
}

function isOpenRoot(thread: ProjectedDiffThread): boolean {
	return !thread.root.is_deleted && !thread.root.is_resolved
}

export function getMissingDiffCommentFileId(repoId: string, path: string): string {
	return `diff-comment-missing:${repoId}:${path}`
}

/** Scroll target for revealing a thread in the code view, mirroring deep-link navigation. */
export function getDiffThreadScrollTarget(thread: ProjectedDiffThread): CodeViewScrollTarget {
	const placement = thread.placement
	if (placement.status === 'current' || placement.status === 'outdated-inline') {
		return {
			type: 'line',
			id: placement.fileId,
			lineNumber: placement.line,
			side: diffCommentSideToPierre(placement.side),
			align: 'nearest',
			behavior: 'instant',
		}
	}
	const id =
		placement.status === 'file-missing'
			? getMissingDiffCommentFileId(placement.repoId, placement.path)
			: placement.fileId
	return { type: 'item', id, align: 'start', behavior: 'instant' }
}

export function projectDiffComments({
	comments,
	files,
	comparisons,
}: {
	readonly comments: readonly ProjectableDiffComment[]
	readonly files: readonly ProjectableDiffFile[]
	readonly comparisons: readonly DiffReviewComparison[]
}): ProjectedDiffComments {
	const roots = comments.filter((comment) => comment.anchor_json && !comment.reply_to_comment_id).sort(compareRows)
	const repliesByRoot = new Map<string, ProjectableDiffComment[]>()
	for (const reply of comments.filter((comment) => comment.reply_to_comment_id && !comment.anchor_json).sort(compareRows)) {
		const rootId = reply.reply_to_comment_id
		if (!rootId) continue
		const replies = repliesByRoot.get(rootId) ?? []
		replies.push(reply)
		repliesByRoot.set(rootId, replies)
	}
	const comparisonsByFileId = new Map(comparisons.map((comparison) => [comparison.fileId, comparison]))
	const threads = roots
		.map((root): ProjectedDiffThread => ({
			root,
			replies: repliesByRoot.get(root.id) ?? [],
			placement: getPlacement(root, files, comparisonsByFileId),
		}))
		.filter((thread) => !thread.root.is_deleted || thread.replies.some((reply) => !reply.is_deleted))

	const annotationsByFile = new Map<string, DiffLineAnnotation<DiffCommentAnnotationMetadata>[]>()
	const fileSections = new Map<string, ProjectedDiffThread[]>()
	const missingGroups = new Map<string, ProjectedDiffThread[]>()
	const openRootCountByFile = new Map<string, number>()
	let openRootCount = 0

	for (const thread of threads) {
		const placement = thread.placement
		if (placement.status === 'current' || placement.status === 'outdated-inline') {
			const annotations = annotationsByFile.get(placement.fileId) ?? []
			annotations.push({
				side: diffCommentSideToPierre(placement.side),
				lineNumber: placement.line,
				metadata: { kind: 'diff-comment-thread', thread },
			})
			annotationsByFile.set(placement.fileId, annotations)
		} else if (placement.status === 'outdated-file' || placement.status === 'pending') {
			const sections = fileSections.get(placement.fileId) ?? []
			sections.push(thread)
			fileSections.set(placement.fileId, sections)
		} else {
			const key = `${placement.repoId}\0${placement.path}`
			const missing = missingGroups.get(key) ?? []
			missing.push(thread)
			missingGroups.set(key, missing)
		}

		if (!isOpenRoot(thread)) continue
		openRootCount += 1
		if ('fileId' in placement) {
			openRootCountByFile.set(placement.fileId, (openRootCountByFile.get(placement.fileId) ?? 0) + 1)
		}
	}

	const missingFiles = [...missingGroups.entries()].map(([key, missingThreads]): MissingDiffCommentFile => {
		const [repoId, path] = key.split('\0')
		return {
			id: getMissingDiffCommentFileId(repoId ?? '', path ?? ''),
			repoId: repoId ?? '',
			path: path ?? '',
			threads: missingThreads,
			openRootCount: missingThreads.filter(isOpenRoot).length,
		}
	})

	return { threads, annotationsByFile, fileSections, missingFiles, openRootCountByFile, openRootCount }
}
