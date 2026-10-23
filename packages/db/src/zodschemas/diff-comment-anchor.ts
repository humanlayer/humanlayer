import z from 'zod/v4'

export const DiffCommentAnchorPointSchema = z.object({
	side: z.enum(['old', 'new']),
	line: z.number().int().positive(),
})

/** Upper bound on `selectedDiff`, in UTF-16 code units, so one comment cannot bloat `anchor_json`. */
export const DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH = 8192

export const DiffCommentAnchorSchema = z.object({
	v: z.literal(1),
	repoId: z.string().min(1),
	path: z.string().min(1),
	/** Right-side version ID (`${fileKey}:${blobId}`); the name predates whole file versions. */
	patchHash: z.string().min(1),
	/** Left-side version ID the comment was written against; missing means the file at task start. */
	sourceVersionId: z.string().min(1).optional(),
	/**
	 * The selected rows of the comparison on screen when the comment was written, one per line,
	 * prefixed ' ' (unchanged), '-' (removed) or '+' (added). A final `… N more lines` line marks
	 * rows left out. A record of what the reviewer saw; it does not follow later file changes.
	 */
	selectedDiff: z.string().min(1).max(DIFF_COMMENT_SELECTED_DIFF_MAX_LENGTH).optional(),
	start: DiffCommentAnchorPointSchema,
	end: DiffCommentAnchorPointSchema,
})

export type DiffCommentAnchorPoint = z.infer<typeof DiffCommentAnchorPointSchema>
export type DiffCommentAnchor = z.infer<typeof DiffCommentAnchorSchema>
