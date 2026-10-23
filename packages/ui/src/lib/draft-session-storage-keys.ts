/**
 * Centralizes the sessionStorage key namespace for transient draft text inputs.
 *
 * Each free-form comment input gets an **independent** draft so in-progress text
 * never bleeds across contexts. The string format lives here, in one place.
 */
export const draftSessionStorageKeys = {
	/** One in-progress new comment per artifact. */
	newComment: (artifactId: string) => `comment:new:${artifactId}`,
	/** Scoped to the comment thread being replied to. */
	reply: (commentId: string) => `comment:reply:${commentId}`,
	/** Scoped to the comment being edited. */
	edit: (commentId: string) => `comment:edit:${commentId}`,
	/** Scoped to one task diff range. Patch hash is omitted so live updates keep the draft. */
	diffCommentRoot: (input: {
		taskId: string
		repoId: string
		path: string
		start: { side: 'old' | 'new'; line: number }
		end: { side: 'old' | 'new'; line: number }
	}) =>
		[
			'diff-comment:new',
			input.taskId,
			input.repoId,
			input.path,
			`${input.start.side}:${input.start.line}`,
			`${input.end.side}:${input.end.line}`,
		]
			.map(encodeURIComponent)
			.join(':'),
	/** Scoped to the diff thread being replied to. */
	diffCommentReply: (rootCommentId: string) => `diff-comment:reply:${encodeURIComponent(rootCommentId)}`,
	/** Scoped to the diff comment being edited. */
	diffCommentEdit: (commentId: string) => `diff-comment:edit:${encodeURIComponent(commentId)}`,
}
