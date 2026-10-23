import type { TaskDiffFileRowType } from '@humanlayer/streams/diff'
import type { DiffFileSort } from '@humanlayer/ui/components/diff-review/diff-file-sort-toggle'

/**
 * Compares two paths byte by byte. `localeCompare` would order the review by the
 * reader's ICU locale, so two people could walk the same task in a different
 * sequence; a diff review has to read the same everywhere.
 */
function comparePath(left: string, right: string): number {
	if (left === right) return 0
	return left < right ? -1 : 1
}

function compareByPath(left: TaskDiffFileRowType, right: TaskDiffFileRowType): number {
	return comparePath(left.repoId, right.repoId) || comparePath(left.path, right.path)
}

/** Most recent capture first; path breaks the tie, which is common. See {@link orderTaskDiffFiles}. */
function compareByRecency(left: TaskDiffFileRowType, right: TaskDiffFileRowType): number {
	if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
	return compareByPath(left, right)
}

function directoryOf(file: TaskDiffFileRowType): string {
	const separator = file.path.lastIndexOf('/')
	return `${file.repoId}/${separator === -1 ? '' : file.path.slice(0, separator)}`
}

/**
 * Keeps each directory's files together, in the order the directories first appear.
 *
 * The file tree always draws a directory's files as one block, so a flat list that
 * interleaves directories would make "next file" leave the folder you are reading and
 * jump back into it later. Grouping here keeps the tree, the diff stack and the j/k
 * navigation on one sequence.
 */
function groupByDirectory(files: readonly TaskDiffFileRowType[]): TaskDiffFileRowType[] {
	const byDirectory = new Map<string, TaskDiffFileRowType[]>()
	for (const file of files) {
		const directory = directoryOf(file)
		const group = byDirectory.get(directory)
		if (group) group.push(file)
		else byDirectory.set(directory, [file])
	}
	return [...byDirectory.values()].flat()
}

/** The recency order of a set of files, with each directory's files kept together. */
export function rankTaskDiffFilesByRecency(rows: readonly TaskDiffFileRowType[]): TaskDiffFileRowType[] {
	return groupByDirectory([...rows].sort(compareByRecency))
}

/**
 * Orders the rows the stream hands over in id order.
 *
 * `path` sorts by repo then path, which never moves while a session runs.
 *
 * `recent` follows `frozenIds`: the recency order taken when the review opened, or when
 * the reader chose this order. Files already in that list keep their place even as the
 * agent writes to them again, so the diff you are reading does not slide out from under
 * you. Files the agent has since added are new to the reader, so they lead the list in
 * recency order.
 *
 * `updatedAt` is stamped per capture, not per keystroke, so files the agent touched in
 * the same capture share a timestamp; a full capture (first publication, a new base ref,
 * or stream recovery) restamps every file at once. Path is the tiebreak, so the order
 * stays stable whenever recency cannot separate two files.
 */
export function orderTaskDiffFiles(
	rows: readonly TaskDiffFileRowType[],
	sort: DiffFileSort,
	frozenIds: readonly string[] = [],
): TaskDiffFileRowType[] {
	if (sort === 'path') return [...rows].sort(compareByPath)
	if (frozenIds.length === 0) return rankTaskDiffFilesByRecency(rows)

	const rank = new Map(frozenIds.map((id, index) => [id, index]))
	const known: TaskDiffFileRowType[] = []
	const added: TaskDiffFileRowType[] = []
	for (const row of rows) {
		if (rank.has(row.id)) known.push(row)
		else added.push(row)
	}
	known.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0))
	return groupByDirectory([...[...added].sort(compareByRecency), ...known])
}
