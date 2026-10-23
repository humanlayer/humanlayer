import type { DiffLineAnnotation, FileDiffMetadata } from '@pierre/diffs'

type AnnotationSide = DiffLineAnnotation<unknown>['side']
type SidedLine = Pick<DiffLineAnnotation<unknown>, 'side' | 'lineNumber'>

/**
 * Names the split-view row a line renders on, so annotations on opposite sides can be compared.
 * Pierre pairs the i-th deleted and i-th added line of a change block on one row, and an unchanged
 * line with its counterpart on the other side. Line 0 is the file-level annotation row.
 */
export function getSplitRowKey(fileDiff: FileDiffMetadata, side: AnnotationSide, lineNumber: number): string {
	if (lineNumber === 0) return 'file'
	// Added minus deleted lines so far; maps an unchanged old line number to its new one.
	let offset = 0
	for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
		let deletionLine = hunk.deletionStart
		let additionLine = hunk.additionStart
		if (lineNumber < (side === 'deletions' ? deletionLine : additionLine)) break
		for (const [blockIndex, block] of hunk.hunkContent.entries()) {
			const ownLine = side === 'deletions' ? deletionLine : additionLine
			if (block.type === 'context') {
				if (lineNumber < ownLine + block.lines) return `line:${additionLine + lineNumber - ownLine}`
				deletionLine += block.lines
				additionLine += block.lines
				continue
			}
			const count = side === 'deletions' ? block.deletions : block.additions
			if (lineNumber < ownLine + count) return `change:${hunkIndex}:${blockIndex}:${lineNumber - ownLine}`
			deletionLine += block.deletions
			additionLine += block.additions
		}
		offset = additionLine - deletionLine
	}
	return `line:${side === 'deletions' ? lineNumber + offset : lineNumber}`
}

/**
 * Whether a split-view annotation can widen across both columns: only when no annotation on the
 * other side renders on the same row, or the two would overlap.
 */
export function canSpanSplitRow(
	fileDiff: FileDiffMetadata,
	annotations: readonly SidedLine[],
	annotation: SidedLine,
): boolean {
	// Split view shows an added or deleted file in one column, so there is no other column to widen into.
	if (fileDiff.type === 'new' || fileDiff.type === 'deleted') return false
	const otherSide: AnnotationSide = annotation.side === 'deletions' ? 'additions' : 'deletions'
	const opposite = annotations.filter((candidate) => candidate.side === otherSide)
	if (opposite.length === 0) return true
	const row = getSplitRowKey(fileDiff, annotation.side, annotation.lineNumber)
	return !opposite.some((candidate) => getSplitRowKey(fileDiff, otherSide, candidate.lineNumber) === row)
}
