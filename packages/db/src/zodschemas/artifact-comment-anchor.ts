import z from 'zod/v4'

export const ArtifactCommentAnchorPointSchema = z.object({
	blockType: z.string().min(1),
	blockText: z.string(),
	previousBlockText: z.string().nullable(),
	nextBlockText: z.string().nullable(),
	offset: z.number().int().min(0),
})

export const ArtifactCommentAnchorSchema = z
	.object({
		v: z.literal(2),
		scope: z.enum(['block', 'range']),
		selectedText: z.string(),
		start: ArtifactCommentAnchorPointSchema,
		end: ArtifactCommentAnchorPointSchema,
	})
	.refine((anchor) => anchor.start.offset <= anchor.start.blockText.length, {
		message: 'start.offset exceeds start.blockText length',
	})
	.refine((anchor) => anchor.end.offset <= anchor.end.blockText.length, {
		message: 'end.offset exceeds end.blockText length',
	})

export type ArtifactCommentAnchorPoint = z.infer<typeof ArtifactCommentAnchorPointSchema>
export type ArtifactCommentAnchor = z.infer<typeof ArtifactCommentAnchorSchema>
