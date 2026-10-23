import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const SharedArtifactCommentAuthorsInputSchema = z.object({
	artifactId: z.uuid(),
	shareKey: z.string().min(1),
})

export const SharedArtifactCommentAuthorSchema = z.object({
	userId: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().nullable(),
})

export const sharedArtifactCommentAuthorsContract = contractBuilder
	.input(SharedArtifactCommentAuthorsInputSchema)
	.output(z.object({ authors: z.array(SharedArtifactCommentAuthorSchema) }))
