import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetArtifactInputSchema = z.object({
	taskId: z.uuid(),
	fileName: z.string().min(1),
})

export const GetArtifactOutputSchema = z.discriminatedUnion('storageType', [
	z.object({
		storageType: z.literal('postgres'),
		content: z.string(),
		contentHash: z.string(),
	}),
	z.object({
		storageType: z.literal('s3'),
		contentHash: z.string(),
		downloadUrl: z.string(),
	}),
])

export const getArtifactContract = contractBuilder.input(GetArtifactInputSchema).output(GetArtifactOutputSchema)
