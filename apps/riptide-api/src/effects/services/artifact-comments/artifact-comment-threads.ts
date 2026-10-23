type CommentRow = {
	id: string
	artifact_id: string
	reply_to_comment_id: string | null
	is_deleted: boolean
	is_resolved: boolean
}

export const buildArtifactCommentThreadIndex = (comments: ReadonlyArray<CommentRow>) => {
	const byId = new Map(comments.map((comment) => [comment.id, comment]))
	const childrenByParent = new Map<string, string[]>()
	for (const comment of comments) {
		if (!comment.reply_to_comment_id) continue
		const children = childrenByParent.get(comment.reply_to_comment_id) ?? []
		children.push(comment.id)
		childrenByParent.set(comment.reply_to_comment_id, children)
	}
	return { byId, childrenByParent }
}

export const getArtifactCommentRootId = (commentId: string, byId: ReadonlyMap<string, CommentRow>) => {
	const visited = new Set<string>()
	let currentId = commentId
	while (!visited.has(currentId)) {
		visited.add(currentId)
		const parentId = byId.get(currentId)?.reply_to_comment_id
		if (!parentId || !byId.has(parentId)) return currentId
		currentId = parentId
	}
	return currentId
}

export const collectArtifactCommentThreadMemberIds = (
	rootId: string,
	childrenByParent: ReadonlyMap<string, string[]>,
) => {
	const result: string[] = []
	const pending = [rootId]
	const seen = new Set<string>()
	while (pending.length) {
		const id = pending.shift()
		if (!id || seen.has(id)) continue
		seen.add(id)
		result.push(id)
		const childIds = childrenByParent.get(id) ?? []
		pending.push(...childIds)
	}
	return result
}
