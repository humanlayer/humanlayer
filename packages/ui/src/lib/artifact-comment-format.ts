/**
 * Desktop artifact-comment format partitioning.
 *
 * Whole threads are partitioned by the ROOT row's `anchor_json`: a root with
 * an anchor envelope is a V2-only thread; a root without one is a legacy/V1
 * thread. Replies are never classified independently — they follow their
 * root — so a V2 root can never leak into V1 general comments, counts,
 * exports, or delivery, and a legacy root can never leak into desktop V2.
 */

export interface PartitionableCommentRow {
	id: string
	reply_to_comment_id: string | null
	anchor_json: unknown
}

export interface CommentFormatPartition<T> {
	/** Threads whose root row carries a V2 `anchor_json` envelope. */
	v2: T[]
	/** Threads whose root row has no `anchor_json` (legacy/V1), plus orphans. */
	legacy: T[]
}

/**
 * Partition comment rows into the two desktop formats by their thread root.
 *
 * - The reply chain is walked to the root (historical rows can nest replies
 *   even though the API normalizes new replies to the root).
 * - Orphaned replies — whose parent chain dangles on a missing row — classify
 *   by the last reachable ancestor's own `anchor_json`, which for legacy data
 *   is null: they stay on the legacy side V1 already renders.
 * - The partition is exhaustive and disjoint: every input row lands in
 *   exactly one side, deterministically, regardless of input order.
 */
export function partitionCommentRowsByRootFormat<T extends PartitionableCommentRow>(
	rows: T[],
): CommentFormatPartition<T> {
	const byId = new Map<string, T>()
	for (const row of rows) byId.set(row.id, row)

	const rootOf = (row: T): T => {
		let current = row
		const seen = new Set<string>([current.id])
		while (current.reply_to_comment_id != null) {
			const parent = byId.get(current.reply_to_comment_id)
			// Dangling parent or defensive cycle guard: classify by the last
			// reachable ancestor.
			if (!parent || seen.has(parent.id)) return current
			seen.add(parent.id)
			current = parent
		}
		return current
	}

	const partition: CommentFormatPartition<T> = { v2: [], legacy: [] }
	for (const row of rows) {
		const root = rootOf(row)
		if (root.anchor_json != null) partition.v2.push(row)
		else partition.legacy.push(row)
	}
	return partition
}
