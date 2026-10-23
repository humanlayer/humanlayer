import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const UpdateArtifactDeletionStatusInputSchema = z.object({
	artifactId: z.uuid(),
	isDeleted: z.boolean(),
})

export const UpdateArtifactDeletionStatusOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const updateArtifactDeletionStatusContract = contractBuilder
	.input(UpdateArtifactDeletionStatusInputSchema)
	.output(UpdateArtifactDeletionStatusOutputSchema)
