import type { ProjectableDiffComment, ProjectedDiffThread } from './project-diff-comments'

export interface ExportedDiffComments {
	readonly xml: string
	readonly rootCommentIds: readonly string[]
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

function getDiffCommentAuthorLabel(comment: ProjectableDiffComment): string {
	const displayName = [comment.author?.firstName, comment.author?.lastName].filter(Boolean).join(' ')
	const author = displayName || comment.author?.email || 'Unknown reviewer'
	return comment.created_by_agent ? `${author}'s agent` : author
}

function compareComments(left: ProjectableDiffComment, right: ProjectableDiffComment): number {
	const byTime = left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1 : 0
	return byTime || left.id.localeCompare(right.id)
}

export function getTruncatedDiffCommentId(commentId: string): string {
	return commentId.replaceAll('-', '').slice(-12)
}

function exportThread(thread: ProjectedDiffThread): string | null {
	const { root } = thread
	const anchor = root.anchor_json
	if (!anchor || root.is_deleted || root.is_resolved) return null

	const state = thread.placement.status === 'current'
		? 'current'
		: 'outdated; file has changed since comment was left'
	const lines = [root, ...thread.replies]
		.sort(compareComments)
		.map((comment) => {
			const body = comment.is_deleted ? 'Comment deleted' : comment.content_text
			return `    ${escapeXml(getDiffCommentAuthorLabel(comment))}: ${escapeXml(body)}`
		})
	if (thread.placement.status !== 'current') {
		lines.push('    read the current file before acting')
	}

	const header = `  <diff_comment id="${getTruncatedDiffCommentId(root.id)}" repo="${escapeXml(anchor.repoId)}" path="${escapeXml(anchor.path)}" start_line="${anchor.start.line}" end_line="${anchor.end.line}" state="${escapeXml(state)}">`
	const exported = [header]
	// The lines the reviewer selected, as they saw them; older comments have none.
	if (anchor.selectedDiff) exported.push(`    <selected_diff>\n${escapeXml(anchor.selectedDiff)}\n    </selected_diff>`)
	exported.push(...lines, '  </diff_comment>')
	return exported.join('\n')
}

export function exportDiffComments(threads: readonly ProjectedDiffThread[]): ExportedDiffComments {
	const exportedThreads: string[] = []
	const rootCommentIds: string[] = []
	for (const thread of threads) {
		const xml = exportThread(thread)
		if (!xml) continue
		exportedThreads.push(xml)
		rootCommentIds.push(thread.root.id)
	}

	return {
		xml: exportedThreads.length === 0
			? '<diff_comments></diff_comments>'
			: `<diff_comments>\n${exportedThreads.join('\n')}\n</diff_comments>`,
		rootCommentIds,
	}
}
