import type { DiffCommentAnchorPoint } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs'

export function diffCommentSideToPierre(side: DiffCommentAnchorPoint['side']): AnnotationSide {
	return side === 'old' ? 'deletions' : 'additions'
}

export function pierreSideToDiffComment(side: AnnotationSide): DiffCommentAnchorPoint['side'] {
	return side === 'deletions' ? 'old' : 'new'
}

/** The anchor's start and end points for a Pierre line selection. */
export function selectedLineRangeToAnchorPoints(range: SelectedLineRange): {
	start: DiffCommentAnchorPoint
	end: DiffCommentAnchorPoint
} {
	return {
		start: { side: pierreSideToDiffComment(range.side ?? 'additions'), line: range.start },
		end: { side: pierreSideToDiffComment(range.endSide ?? range.side ?? 'additions'), line: range.end },
	}
}
