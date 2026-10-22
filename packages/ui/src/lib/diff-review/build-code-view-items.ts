import {
	parseDiffFromFile,
	type CodeViewItem,
	type DiffLineAnnotation,
	type FileContents,
	type FileDiffMetadata,
} from '@pierre/diffs'

import type {
	DiffReviewAnnotationMetadata,
	MissingDiffCommentFile,
	ProjectedDiffThread,
} from './project-diff-comments'

export interface DiffReviewFile {
	id: string
	binary: boolean
	/** A side of the file is too large to publish; render a message instead of a skeleton. */
	omittedReason?: 'too_large'
}

/**
 * The two complete bodies one file is compared across. `null` marks a side that does not exist
 * (an added file's old side, a deleted file's new side). Each side's `cacheKey` must identify its
 * contents; the built diff is cached by the pair.
 */
export interface DiffReviewComparison {
	fileId: string
	oldFile: FileContents | null
	newFile: FileContents | null
	/**
	 * Version ID of the left side when it is a saved version rather than the file at task start.
	 * New comment anchors record it; comments on the old side stay current only while it matches.
	 */
	sourceVersionId?: string
}

const COMPARISON_DIFF_CACHE_LIMIT = 500
const comparisonDiffCache = new Map<string, FileDiffMetadata | null>()

function comparisonCacheKey({ oldFile, newFile }: DiffReviewComparison): string | undefined {
	if ((oldFile && !oldFile.cacheKey) || (newFile && !newFile.cacheKey)) return undefined
	return JSON.stringify([oldFile?.name, oldFile?.cacheKey ?? null, newFile?.name, newFile?.cacheKey ?? null])
}

/**
 * Builds Pierre's complete (non-partial) diff for a comparison, so unchanged sections can expand.
 * Items, comment placement, excerpts, and the navigation index all read this one result, which
 * keeps their line numbers in agreement. Returns `null` when neither side exists.
 */
export function getComparisonDiff(comparison: DiffReviewComparison): FileDiffMetadata | null {
	const key = comparisonCacheKey(comparison)
	if (key !== undefined && comparisonDiffCache.has(key)) {
		const cached = comparisonDiffCache.get(key) ?? null
		// Refresh recency so the cache evicts the least recently used pair.
		comparisonDiffCache.delete(key)
		comparisonDiffCache.set(key, cached)
		return cached
	}
	const fileDiff =
		comparison.oldFile === null && comparison.newFile === null
			? null
			: parseDiffFromFile(comparison.oldFile, comparison.newFile)
	if (key !== undefined) {
		comparisonDiffCache.set(key, fileDiff)
		if (comparisonDiffCache.size > COMPARISON_DIFF_CACHE_LIMIT) {
			const oldest = comparisonDiffCache.keys().next().value
			if (oldest !== undefined) comparisonDiffCache.delete(oldest)
		}
	}
	return fileDiff
}

/** Line totals for the comparison on screen, not the file's cumulative capture counts. */
export function getDiffLineCounts(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
	let additions = 0
	let deletions = 0
	for (const hunk of fileDiff.hunks) {
		additions += hunk.additionLines
		deletions += hunk.deletionLines
	}
	return { additions, deletions }
}

export type DiffReviewCodeViewItem = CodeViewItem<DiffReviewAnnotationMetadata>

export interface DiffReviewCodeViewModel {
	items: DiffReviewCodeViewItem[]
	itemsByFileId: ReadonlyMap<string, DiffReviewCodeViewItem>
}

export interface DiffReviewCommentPlacement {
	annotationsByFile?: ReadonlyMap<string, readonly DiffLineAnnotation<DiffReviewAnnotationMetadata>[]>
	fileSections?: ReadonlyMap<string, readonly ProjectedDiffThread[]>
	missingFiles?: readonly MissingDiffCommentFile[]
}

interface CodeViewItemVersionEntry {
	readonly signature: string
	readonly version: number
}

export type CodeViewItemVersionState = Map<string, CodeViewItemVersionEntry>

export function createCodeViewItemVersionState(): CodeViewItemVersionState {
	return new Map()
}

function getItemVersion(state: CodeViewItemVersionState, id: string, value: unknown): number {
	const signature = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $bigint: item.toString() } : item)
	const current = state.get(id)
	if (current?.signature === signature) return current.version
	const version = (current?.version ?? 0) + 1
	state.set(id, { signature, version })
	return version
}

export function buildCodeViewModel(
	files: readonly DiffReviewFile[],
	comparisons: readonly DiffReviewComparison[],
	collapsedIds: ReadonlySet<string> = new Set(),
	comments: DiffReviewCommentPlacement = {},
	versionState: CodeViewItemVersionState = createCodeViewItemVersionState(),
): DiffReviewCodeViewModel {
	const items = buildCodeViewItems(files, comparisons, collapsedIds, comments, versionState)
	return { items, itemsByFileId: new Map(items.map((item) => [item.id, item])) }
}

export function buildCodeViewItems(
	files: readonly DiffReviewFile[],
	comparisons: readonly DiffReviewComparison[],
	collapsedIds: ReadonlySet<string> = new Set(),
	comments: DiffReviewCommentPlacement = {},
	versionState: CodeViewItemVersionState = createCodeViewItemVersionState(),
): DiffReviewCodeViewItem[] {
	const comparisonsByFileId = new Map(comparisons.map((comparison) => [comparison.fileId, comparison]))
	const items: DiffReviewCodeViewItem[] = []
	for (const file of files) {
		const collapsed = collapsedIds.has(file.id)
		const comparison = file.binary || file.omittedReason ? undefined : comparisonsByFileId.get(file.id)
		const fileDiff = comparison ? getComparisonDiff(comparison) : null
		const fileSection = comments.fileSections?.get(file.id)
		const lineAnnotations = comments.annotationsByFile?.get(file.id) ?? []
		const version = getItemVersion(versionState, file.id, {
			// Cache keys identify both bodies without hashing their contents.
			comparison: comparison ? comparisonCacheKey(comparison) ?? comparison : undefined,
			hasRenderableDiff: fileDiff !== null,
			collapsed,
			lineAnnotations,
			fileSection,
			binary: file.binary,
			omittedReason: file.omittedReason,
		})
		if (!fileDiff) {
			const awaitingComparison = !file.binary && !file.omittedReason
			items.push({
			id: file.id,
			type: 'file',
			file: {
				name: file.id,
				contents: file.binary
					? 'Binary file cannot be displayed.'
					: file.omittedReason
						? 'This diff is too large to display.'
						: '',
			},
				version,
				collapsed,
				annotations: collapsed ? undefined : [
					...(awaitingComparison ? [{ lineNumber: 0, metadata: { kind: 'diff-loading' as const } }] : []),
					...(fileSection?.length ? [{ lineNumber: 0, metadata: { kind: 'diff-comment-file-section' as const, threads: fileSection, missing: false } }] : []),
				],
			})
			continue
		}
		items.push({
			id: file.id,
			type: 'diff',
			fileDiff,
			version,
			collapsed,
			annotations: [
				...lineAnnotations,
				...(fileSection?.length
					? [{ side: 'additions' as const, lineNumber: 0, metadata: { kind: 'diff-comment-file-section' as const, threads: fileSection, missing: false } }]
					: []),
			],
		})
	}
	for (const missing of comments.missingFiles ?? []) {
		const collapsed = collapsedIds.has(missing.id)
		const version = getItemVersion(versionState, missing.id, { missing, collapsed })
		items.push({
			id: missing.id,
			type: 'file',
			file: { name: `${missing.repoId}/${missing.path}`, contents: '' },
			collapsed,
			version,
			// The comment thread is this item's only content, so collapsing drops
			// the annotation rather than relying on Pierre to hide it.
			annotations: collapsed
				? undefined
				: [{
					lineNumber: 0,
					metadata: {
						kind: 'diff-comment-file-section',
						threads: missing.threads,
						repoId: missing.repoId,
						path: missing.path,
						missing: true,
					},
				}],
		})
	}
	return items
}
