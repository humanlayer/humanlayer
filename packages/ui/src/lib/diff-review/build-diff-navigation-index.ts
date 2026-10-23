import type { CodeViewItem, Hunk, SelectionSide } from '@pierre/diffs'

export type DiffNavigationTarget =
	| { id: string; kind: 'header'; fileId: string }
	| { id: string; kind: 'line'; fileId: string; lineNumber: number; side: SelectionSide }
	| { id: string; kind: 'placeholder'; fileId: string; placeholder: 'binary' | 'pending' }

export interface DiffNavigationIndex {
	targets: readonly DiffNavigationTarget[]
	move: (target: DiffNavigationTarget | null, direction: 1 | -1) => DiffNavigationTarget | null
	moveFile: (target: DiffNavigationTarget | null, direction: 1 | -1) => DiffNavigationTarget | null
	linesForFile: (fileId: string) => readonly Extract<DiffNavigationTarget, { kind: 'line' }>[]
}

export function createDiffLineNavigationTarget(
	fileId: string,
	lineNumber: number,
	side: SelectionSide,
): Extract<DiffNavigationTarget, { kind: 'line' }> {
	return { id: `line:${fileId}:${side}:${lineNumber}`, kind: 'line', fileId, lineNumber, side }
}

export function createDiffHeaderNavigationTarget(
	fileId: string,
): Extract<DiffNavigationTarget, { kind: 'header' }> {
	return { id: `header:${fileId}`, kind: 'header', fileId }
}

function unifiedHunkTargets(fileId: string, hunk: Hunk): DiffNavigationTarget[] {
	const targets: DiffNavigationTarget[] = []
	let deletionLine = hunk.deletionStart
	let additionLine = hunk.additionStart
	for (const content of hunk.hunkContent) {
		if (content.type === 'context') {
			for (let offset = 0; offset < content.lines; offset += 1) {
				targets.push(createDiffLineNavigationTarget(fileId, additionLine + offset, 'additions'))
			}
			deletionLine += content.lines
			additionLine += content.lines
			continue
		}
		for (let offset = 0; offset < content.deletions; offset += 1) {
			targets.push(createDiffLineNavigationTarget(fileId, deletionLine + offset, 'deletions'))
		}
		for (let offset = 0; offset < content.additions; offset += 1) {
			targets.push(createDiffLineNavigationTarget(fileId, additionLine + offset, 'additions'))
		}
		deletionLine += content.deletions
		additionLine += content.additions
	}
	return targets
}

function splitHunkTargets(fileId: string, hunk: Hunk): DiffNavigationTarget[] {
	const targets: DiffNavigationTarget[] = []
	let deletionLine = hunk.deletionStart
	let additionLine = hunk.additionStart
	for (const content of hunk.hunkContent) {
		if (content.type === 'context') {
			for (let offset = 0; offset < content.lines; offset += 1) {
				targets.push(createDiffLineNavigationTarget(fileId, additionLine + offset, 'additions'))
			}
			deletionLine += content.lines
			additionLine += content.lines
			continue
		}
		const rowCount = Math.max(content.deletions, content.additions)
		for (let offset = 0; offset < rowCount; offset += 1) {
			if (offset < content.deletions) {
				targets.push(createDiffLineNavigationTarget(fileId, deletionLine + offset, 'deletions'))
			}
			if (offset < content.additions) {
				targets.push(createDiffLineNavigationTarget(fileId, additionLine + offset, 'additions'))
			}
		}
		deletionLine += content.deletions
		additionLine += content.additions
	}
	return targets
}

export function buildDiffNavigationIndex<TMetadata>(
	items: readonly CodeViewItem<TMetadata>[],
	diffStyle: 'unified' | 'split',
	binaryFileIds: ReadonlySet<string> = new Set(),
): DiffNavigationIndex {
	const targets: DiffNavigationTarget[] = []
	const headers: DiffNavigationTarget[] = []
	const linesByFileId = new Map<string, Extract<DiffNavigationTarget, { kind: 'line' }> []>()

	for (const item of items) {
		const header = createDiffHeaderNavigationTarget(item.id)
		headers.push(header)
		targets.push(header)
		if (item.collapsed) continue
		if (item.type === 'file') {
			const placeholder = binaryFileIds.has(item.id) ? 'binary' : 'pending'
			targets.push({ id: `placeholder:${item.id}:${placeholder}`, kind: 'placeholder', fileId: item.id, placeholder })
			continue
		}
		const fileLines = item.fileDiff.hunks.flatMap((hunk) =>
			diffStyle === 'split' ? splitHunkTargets(item.id, hunk) : unifiedHunkTargets(item.id, hunk),
		) as Extract<DiffNavigationTarget, { kind: 'line' }>[]
		linesByFileId.set(item.id, fileLines)
		targets.push(...fileLines)
	}

	const moveWithin = (
		orderedTargets: readonly DiffNavigationTarget[],
		target: DiffNavigationTarget | null,
		direction: 1 | -1,
	): DiffNavigationTarget | null => {
		if (orderedTargets.length === 0) return null
		if (!target) return orderedTargets[0] ?? null
		const index = orderedTargets.findIndex((candidate) => candidate.id === target.id)
		if (index === -1) return orderedTargets[0] ?? null
		return orderedTargets[Math.max(0, Math.min(orderedTargets.length - 1, index + direction))] ?? null
	}

	return {
		targets,
		move: (target, direction) => moveWithin(targets, target, direction),
		moveFile: (target, direction) => {
			if (headers.length === 0) return null
			if (!target) return headers[0] ?? null
			const currentFileIndex = headers.findIndex((header) => header.fileId === target.fileId)
			if (currentFileIndex === -1) return headers[0] ?? null
			return headers[Math.max(0, Math.min(headers.length - 1, currentFileIndex + direction))] ?? null
		},
		linesForFile: (fileId) => linesByFileId.get(fileId) ?? [],
	}
}
