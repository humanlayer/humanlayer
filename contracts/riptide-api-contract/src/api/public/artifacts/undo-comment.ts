import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { PublicArtifactCommentMutationOutputSchema } from './create-comment'

export const undoPublicArtifactCommentContract = contractBuilder
	.input(
		z.object({
			artifactId: z.uuid(),
			shareKey: z.string().min(1).max(512),
			commentId: z.uuid(),
			undoToken: z.string().min(1).max(512),
		}),
	)
	.output(PublicArtifactCommentMutationOutputSchema)
