/** How a block of the newer version differs from the older one. */
export type BlockChange = 'added' | 'changed'

export type DocChanges = {
	/** Blocks of the newer version that are new or reworded, by index. */
	marks: Map<number, BlockChange>
	/** Blocks the newer version dropped, by the index of the newer block they sat before. */
	removed: Map<number, string[]>
	counts: { added: number; changed: number; removed: number }
}

/**
 * What changed between two versions of a document, block by block. Blocks match on their text
 * with whitespace ignored. A run of removed blocks next to a run of added ones reads as those
 * blocks reworded, pairing as many as both runs have.
 */
export function diffBlocks(before: readonly string[], after: readonly string[]): DocChanges {
	const a = before.map(normalize)
	const b = after.map(normalize)
	// Longest common subsequence lengths of every pair of suffixes, so the walk below can go forward.
	const width = b.length + 1
	const table = new Array<number>((a.length + 1) * width).fill(0)
	const common = (i: number, j: number) => table[i * width + j] ?? 0
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i * width + j] =
				a[i] === b[j] ? common(i + 1, j + 1) + 1 : Math.max(common(i + 1, j), common(i, j + 1))
		}
	}

	const changes: DocChanges = { marks: new Map(), removed: new Map(), counts: { added: 0, changed: 0, removed: 0 } }
	let dropped: string[] = []
	let inserted: number[] = []
	const flush = (at: number) => {
		const paired = Math.min(dropped.length, inserted.length)
		inserted.forEach((index, n) => changes.marks.set(index, n < paired ? 'changed' : 'added'))
		changes.counts.changed += paired
		changes.counts.added += inserted.length - paired
		const gone = dropped.slice(paired)
		if (gone.length > 0) changes.removed.set(at, gone)
		changes.counts.removed += gone.length
		dropped = []
		inserted = []
	}

	let i = 0
	let j = 0
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			flush(j)
			i++
			j++
		} else if (j < b.length && (i === a.length || common(i, j + 1) >= common(i + 1, j))) {
			inserted.push(j++)
		} else {
			dropped.push(before[i++] ?? '')
		}
	}
	flush(b.length)
	return changes
}

function normalize(block: string): string {
	return block.replace(/\s+/g, ' ').trim()
}

type ArchivedVersion = { id: string; versionNumber: number; createdAt: number }

/** Saves closer together than this are one revision: an agent writes a file several times in a turn. */
const REVISION_GAP_MS = 5 * 60_000

/**
 * The version to compare the latest against: the text from before the latest revision. An archived
 * version holds the text a save replaced, stamped with that save, so walk back through saves that
 * came close together and take the oldest text they replaced.
 */
export function revisionBase<Version extends ArchivedVersion>(archived: readonly Version[]): Version | null {
	const newestFirst = [...archived].sort((a, b) => b.versionNumber - a.versionNumber)
	let base = newestFirst[0] ?? null
	for (const older of newestFirst.slice(1)) {
		if (!base || base.createdAt - older.createdAt > REVISION_GAP_MS) break
		base = older
	}
	return base
}
