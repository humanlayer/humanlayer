import {
	DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH,
	type DiffCommentAnchor,
	type DiffCommentAnchorPoint,
} from '@humanlayer/db/zodschemas/diff-comment-anchor'
import type { FileDiffMetadata } from '@pierre/diffs'

import { getComparisonDiff, type DiffReviewComparison } from './build-code-view-items'
import type { ProjectedDiffThread } from './project-diff-comments'

export interface DiffCommentExcerpt {
	/**
	 * A standalone unified diff covering just the anchored region. The panel
	 * renders it through Pierre's `FileDiff`, so it reuses the same worker
	 * highlighter as the main diff and matches its tokens, washes, and gutters
	 * automatically — no second highlighter, no hand-rolled colors.
	 */
	readonly patch: string
	/** Anchored lines trimmed from the start of the range to fit the cap. */
	readonly hiddenLineCount: number
}

export const DIFF_COMMENT_EXCERPT_MAX_LINES = 4

interface ExcerptRow {
	readonly oldLine: number | null
	readonly newLine: number | null
	/** Old-file line the row sits at, tracked even for additions so a sliced
	 * excerpt can still emit a valid hunk header. */
	readonly oldCursor: number
	readonly newCursor: number
	readonly kind: 'context' | 'deletion' | 'addition'
	readonly text: string
}

function lineText(lines: readonly string[], index: number): string {
	return (lines[index] ?? '').replace(/\r?\n$/, '')
}

// Walk the file diff into ordered rows in unified-diff order (context, then
// deletions, then additions within each change block), carrying each row's
// old/new line numbers and the running cursors. A complete diff also yields the
// unchanged lines between hunks, so comments on expanded context get excerpts.
function buildRows(parsed: FileDiffMetadata): ExcerptRow[] {
	const rows: ExcerptRow[] = []
	let oldLine = 1
	let newLine = 1
	const pushUnchanged = (count: number) => {
		for (let offset = 0; offset < count; offset += 1) {
			rows.push({
				oldLine,
				newLine,
				oldCursor: oldLine,
				newCursor: newLine,
				kind: 'context',
				text: lineText(parsed.additionLines, newLine - 1),
			})
			oldLine += 1
			newLine += 1
		}
	}
	for (const hunk of parsed.hunks) {
		if (!parsed.isPartial) pushUnchanged(hunk.additionStart - newLine)
		oldLine = hunk.deletionStart
		newLine = hunk.additionStart
		for (const block of hunk.hunkContent) {
			if (block.type === 'context') {
				for (let offset = 0; offset < block.lines; offset += 1) {
					rows.push({
						oldLine,
						newLine,
						oldCursor: oldLine,
						newCursor: newLine,
						kind: 'context',
						text: lineText(parsed.additionLines, block.additionLineIndex + offset),
					})
					oldLine += 1
					newLine += 1
				}
				continue
			}
			for (let offset = 0; offset < block.deletions; offset += 1) {
				rows.push({
					oldLine,
					newLine: null,
					oldCursor: oldLine,
					newCursor: newLine,
					kind: 'deletion',
					text: lineText(parsed.deletionLines, block.deletionLineIndex + offset),
				})
				oldLine += 1
			}
			for (let offset = 0; offset < block.additions; offset += 1) {
				rows.push({
					oldLine: null,
					newLine,
					oldCursor: oldLine,
					newCursor: newLine,
					kind: 'addition',
					text: lineText(parsed.additionLines, block.additionLineIndex + offset),
				})
				newLine += 1
			}
		}
	}
	if (!parsed.isPartial) pushUnchanged(parsed.additionLines.length - (newLine - 1))
	return rows
}

interface AnchorInterval {
	readonly side: 'old' | 'new'
	readonly start: number
	readonly end: number
}

function anchorIntervals(anchor: DiffCommentAnchor): readonly AnchorInterval[] {
	if (anchor.start.side === anchor.end.side) {
		return [{
			side: anchor.start.side,
			start: Math.min(anchor.start.line, anchor.end.line),
			end: Math.max(anchor.start.line, anchor.end.line),
		}]
	}
	return [
		{ side: anchor.start.side, start: anchor.start.line, end: anchor.start.line },
		{ side: anchor.end.side, start: anchor.end.line, end: anchor.end.line },
	]
}

function rowMatchesAnchor(row: ExcerptRow, intervals: readonly AnchorInterval[]): boolean {
	return intervals.some((interval) =>
		interval.side === 'old'
			? row.oldLine !== null && row.oldLine >= interval.start && row.oldLine <= interval.end
			: row.newLine !== null && row.newLine >= interval.start && row.newLine <= interval.end,
	)
}

const ROW_SIGN: Record<ExcerptRow['kind'], string> = {
	context: ' ',
	deletion: '-',
	addition: '+',
}

export const DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS = 50

// Room kept for the final "… N more lines" line and its newline.
const SELECTED_DIFF_MARKER_RESERVE = 32

function rowIndexAt(rows: readonly ExcerptRow[], point: DiffCommentAnchorPoint): number {
	return rows.findIndex((row) => (point.side === 'old' ? row.oldLine : row.newLine) === point.line)
}

// Cut a line to `max` code units without splitting a surrogate pair, which Postgres jsonb rejects.
function clipLine(line: string, max: number): string {
	let clipped = line.slice(0, Math.max(0, max - 1))
	const last = clipped.charCodeAt(clipped.length - 1)
	if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1)
	return `${clipped}…`
}

/**
 * Records the selected rows of a comparison as a small unified-diff snippet for the comment's
 * anchor: every row from the start point to the end point in unified-diff order, one per line,
 * prefixed ' ' (unchanged), '-' (removed) or '+' (added). Keeps the first
 * {@link DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS} rows within the anchor's length cap and ends with
 * `… N more lines` when rows are left out. Returns `undefined` when a point is not in the diff.
 */
export function buildDiffCommentSelectedDiff(
	parsed: FileDiffMetadata,
	range: Pick<DiffCommentAnchor, 'start' | 'end'>,
): string | undefined {
	const rows = buildRows(parsed)
	const startIndex = rowIndexAt(rows, range.start)
	const endIndex = rowIndexAt(rows, range.end)
	if (startIndex === -1 || endIndex === -1) return undefined
	const selected = rows.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
	const budget = DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH - SELECTED_DIFF_MARKER_RESERVE
	const lines: string[] = []
	let length = 0
	for (const row of selected.slice(0, DIFF_COMMENT_SELECTED_DIFF_MAX_ROWS)) {
		const line = `${ROW_SIGN[row.kind]}${row.text}`
		const nextLength = length + (lines.length > 0 ? 1 : 0) + line.length
		if (nextLength > budget) {
			// A first row too long for the cap is cut rather than dropped, so the snippet never goes empty.
			if (lines.length === 0) lines.push(clipLine(line, budget))
			break
		}
		lines.push(line)
		length = nextLength
	}
	const leftOut = selected.length - lines.length
	if (leftOut > 0) lines.push(`… ${leftOut} more ${leftOut === 1 ? 'line' : 'lines'}`)
	return lines.join('\n')
}

// Emit a standalone unified diff for the anchored rows. Keeping the real file
// path in the header lets Pierre infer the language, so the excerpt highlights
// exactly like the file it came from.
function synthesizeExcerpt(parsed: FileDiffMetadata, anchor: DiffCommentAnchor): DiffCommentExcerpt | null {
	const intervals = anchorIntervals(anchor)
	const matched = buildRows(parsed).filter((row) => rowMatchesAnchor(row, intervals))
	if (matched.length === 0) return null
	const hiddenLineCount = Math.max(0, matched.length - DIFF_COMMENT_EXCERPT_MAX_LINES)
	const shown = matched.slice(hiddenLineCount)
	const first = shown[0]
	if (first === undefined) return null
	const oldStart = first.oldCursor
	const newStart = first.newCursor
	const oldCount = shown.filter((row) => row.kind !== 'addition').length
	const newCount = shown.filter((row) => row.kind !== 'deletion').length
	const { path } = anchor
	const patch = [
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
		...shown.map((row) => `${ROW_SIGN[row.kind]}${row.text}`),
		'',
	].join('\n')
	return { patch, hiddenLineCount }
}

/**
 * Recovers the diff text each thread was anchored on. `resolveComparison` returns
 * the comparison the anchor was written against: the anchored `patchHash` version
 * on the right, and on the left its `sourceVersionId` version or, without one, the
 * file at task start. The versions stream keeps history, so both usually stay
 * available after the file moves on; threads whose versions are gone (for example
 * after a stream rebuild) are simply absent from the map.
 */
export function extractDiffCommentExcerpts(
	threads: readonly ProjectedDiffThread[],
	resolveComparison: (anchor: DiffCommentAnchor) => DiffReviewComparison | undefined,
): ReadonlyMap<string, DiffCommentExcerpt> {
	const excerpts = new Map<string, DiffCommentExcerpt>()
	for (const thread of threads) {
		const anchor = thread.root.anchor_json
		if (!anchor) continue
		const comparison = resolveComparison(anchor)
		const parsed = comparison ? getComparisonDiff(comparison) : null
		if (!parsed) continue
		const excerpt = synthesizeExcerpt(parsed, anchor)
		if (excerpt) excerpts.set(thread.root.id, excerpt)
	}
	return excerpts
}
