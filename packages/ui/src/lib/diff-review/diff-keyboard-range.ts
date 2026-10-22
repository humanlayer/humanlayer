import type { DiffNavigationTarget } from './build-diff-navigation-index'

export type DiffLineNavigationTarget = Extract<DiffNavigationTarget, { kind: 'line' }>

export interface DiffKeyboardRange {
	anchor: DiffLineNavigationTarget
	head: DiffLineNavigationTarget
}

export function startDiffKeyboardRange(target: DiffLineNavigationTarget): DiffKeyboardRange {
	return { anchor: target, head: target }
}

export function extendDiffKeyboardRange(
	range: DiffKeyboardRange,
	fileLines: readonly DiffLineNavigationTarget[],
	direction: 1 | -1,
): DiffKeyboardRange {
	if (range.anchor.fileId !== range.head.fileId) return range
	const headIndex = fileLines.findIndex((target) => target.id === range.head.id)
	if (headIndex === -1) return range
	const nextIndex = Math.max(0, Math.min(fileLines.length - 1, headIndex + direction))
	const head = fileLines[nextIndex]
	return head ? { anchor: range.anchor, head } : range
}

export function orderedDiffKeyboardRange(
	range: DiffKeyboardRange,
	fileLines: readonly DiffLineNavigationTarget[],
): readonly DiffLineNavigationTarget[] {
	const anchorIndex = fileLines.findIndex((target) => target.id === range.anchor.id)
	const headIndex = fileLines.findIndex((target) => target.id === range.head.id)
	if (anchorIndex === -1 || headIndex === -1) return []
	return fileLines.slice(Math.min(anchorIndex, headIndex), Math.max(anchorIndex, headIndex) + 1)
}
