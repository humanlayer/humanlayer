export interface ArtifactCommentCountRow {
	artifact_id: string
	is_deleted: boolean
}

export function countArtifactComments(rows: ArtifactCommentCountRow[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const row of rows) {
		if (row.is_deleted) continue
		counts.set(row.artifact_id, (counts.get(row.artifact_id) ?? 0) + 1)
	}
	return counts
}
