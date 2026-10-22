import {
	fileKeyFor,
	type TaskDiffFileBaselineRowType,
	type TaskDiffFileRowType,
	type TaskDiffFileVersionRowType,
} from '@humanlayer/streams/diff'
import type { DiffReviewComparison } from '@humanlayer/ui/lib/diff-review/build-code-view-items'
import { useMemo } from 'react'

import type { DiffComparison, TaskDiffReviewMark } from '@/hooks/stores/taskDiffReviewMarksStore'

import type { TaskDiffVersionsResult } from './useTaskDiffVersions'

export interface TaskDiffComparisons {
	/** One comparison per text file whose bodies have arrived. */
	comparisons: readonly DiffReviewComparison[]
	/** Files with a side too large to publish; they render a message instead of a diff. */
	omittedFileIds: ReadonlySet<string>
}

type ComparisonFile = Pick<TaskDiffFileRowType, 'id' | 'repoId' | 'path' | 'prevPath' | 'binary' | 'versionId'>

function baselineContents(baseline: TaskDiffFileBaselineRowType) {
	if (baseline.content === null) return null
	// Baselines are rewritten when the task's Git base moves, so the key carries their write time.
	return {
		name: baseline.path,
		contents: baseline.content,
		cacheKey: `baseline:${baseline.id}@${baseline.updatedAt}`,
	}
}

function versionContents(version: TaskDiffFileVersionRowType, path: string) {
	if (version.content === null) return null
	return { name: path, contents: version.content, cacheKey: version.id }
}

export interface TaskDiffComparisonSelection {
	comparison: DiffComparison
	/** fileKey -> the version marked reviewed and the one marked before it. */
	reviewed: Readonly<Record<string, TaskDiffReviewMark>>
	/** fileKey -> a mark the reader removed; its previous version is the last one still approved. */
	unmarked?: Readonly<Record<string, TaskDiffReviewMark>>
}

function leftFromBaseline(baseline: TaskDiffFileBaselineRowType | undefined) {
	return baseline ? { row: baseline, contents: baselineContents(baseline) } : undefined
}

const SINCE_TASK_START: TaskDiffComparisonSelection = { comparison: 'since-task-start', reviewed: {} }

/**
 * The reviewed version a file's left side starts from in `since-last-review`, if any. A file
 * changed since review starts from the reviewed version. A file whose current version is the
 * reviewed one never shows an empty diff: it starts from the version reviewed before that. A
 * file whose mark the reader removed starts from the version approved before the removed one.
 * A version the stream no longer holds, or no earlier review, falls back to task start.
 */
function reviewedLeftVersion(
	file: ComparisonFile,
	fileKey: string,
	versions: TaskDiffVersionsResult['versions'],
	{ comparison, reviewed, unmarked }: TaskDiffComparisonSelection,
): TaskDiffFileVersionRowType | undefined {
	if (comparison !== 'since-last-review') return undefined
	const mark = reviewed[fileKey]
	const leftVersionId = mark
		? mark.versionId === file.versionId
			? mark.previousVersionId
			: mark.versionId
		: unmarked?.[fileKey]?.previousVersionId
	// A file reverted to an approved version would otherwise compare with itself.
	if (!leftVersionId || leftVersionId === file.versionId) return undefined
	return versions.get(leftVersionId)
}

/**
 * Pairs each current file with its left and right bodies. The right side is the version the
 * file row points at. The left side is the file at task start, or in `since-last-review` the
 * version last marked reviewed. A file whose rows have not arrived yet gets no comparison and
 * keeps its loading placeholder.
 */
export function getTaskDiffComparisons(
	files: readonly ComparisonFile[],
	{ baselines, versions }: Pick<TaskDiffVersionsResult, 'baselines' | 'versions'>,
	selection: TaskDiffComparisonSelection = SINCE_TASK_START,
): TaskDiffComparisons {
	const comparisons: DiffReviewComparison[] = []
	const omittedFileIds = new Set<string>()
	for (const file of files) {
		if (file.binary || !file.versionId) continue
		const fileKey = fileKeyFor(file.repoId, file.path, file.prevPath)
		const version = versions.get(file.versionId)
		const reviewedVersion = reviewedLeftVersion(file, fileKey, versions, selection)
		const left = reviewedVersion
			? { row: reviewedVersion, contents: versionContents(reviewedVersion, reviewedVersion.path) }
			: leftFromBaseline(baselines.get(fileKey))
		if (!left || !version) continue
		if (left.row.omittedReason || version.omittedReason) {
			omittedFileIds.add(file.id)
			continue
		}
		comparisons.push({
			fileId: file.id,
			oldFile: left.contents,
			newFile: versionContents(version, file.path),
			sourceVersionId: reviewedVersion?.id,
		})
	}
	return { comparisons, omittedFileIds }
}

export function useTaskDiffComparisons(
	files: readonly ComparisonFile[],
	{ baselines, versions }: Pick<TaskDiffVersionsResult, 'baselines' | 'versions'>,
	{ comparison, reviewed, unmarked }: TaskDiffComparisonSelection,
): TaskDiffComparisons {
	return useMemo(
		() => getTaskDiffComparisons(files, { baselines, versions }, { comparison, reviewed, unmarked }),
		[files, baselines, versions, comparison, reviewed, unmarked],
	)
}

/**
 * Version IDs named by review marks that the ready stream does not hold, e.g. after the stream
 * was rebuilt. Git can restore task start and current bodies, not the ones in between.
 */
export function getMissingReviewVersionIds(
	marks: readonly Readonly<Record<string, TaskDiffReviewMark>>[],
	versions: { has: (versionId: string) => boolean },
): string[] {
	const missing = new Set<string>()
	for (const byFileKey of marks) {
		for (const { versionId, previousVersionId } of Object.values(byFileKey)) {
			if (!versions.has(versionId)) missing.add(versionId)
			if (previousVersionId && !versions.has(previousVersionId)) missing.add(previousVersionId)
		}
	}
	return [...missing]
}

/** Adds the too-large marker the code view stack reads to each omitted file. */
export function withOmittedReasons<T extends { id: string }>(
	files: readonly T[],
	omittedFileIds: ReadonlySet<string>,
): readonly (T & { omittedReason?: 'too_large' })[] {
	if (omittedFileIds.size === 0) return files
	return files.map((file) => (omittedFileIds.has(file.id) ? { ...file, omittedReason: 'too_large' as const } : file))
}

/**
 * The comparison a comment was written against: its anchored right-side version, compared with
 * its saved left-side version, or with the file at task start when the anchor saved none. Returns
 * `undefined` once either version is no longer in the stream.
 */
export function getTaskDiffAnchorComparison(
	anchor: { readonly patchHash: string; readonly sourceVersionId?: string; readonly path: string },
	{ baselines, versions }: Pick<TaskDiffVersionsResult, 'baselines' | 'versions'>,
): DiffReviewComparison | undefined {
	const version = versions.get(anchor.patchHash)
	if (!version || version.omittedReason) return undefined
	const newFile = versionContents(version, anchor.path)
	if (anchor.sourceVersionId) {
		const source = versions.get(anchor.sourceVersionId)
		if (!source || source.omittedReason) return undefined
		return {
			fileId: `anchor:${source.id}..${version.id}`,
			oldFile: versionContents(source, source.path),
			newFile,
			sourceVersionId: source.id,
		}
	}
	const baseline = baselines.get(version.fileKey)
	if (!baseline || baseline.omittedReason) return undefined
	return { fileId: `anchor:${version.id}`, oldFile: baselineContents(baseline), newFile }
}
