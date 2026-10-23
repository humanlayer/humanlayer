import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ListArtifactsInputSchema = z.object({
	taskId: z.uuid(),
})

export const ArtifactListItemSchema = z.object({
	fileName: z.string(),
	contentHash: z.string(),
	storageType: z.enum(['postgres', 's3']),
	fileSizeBytes: z.number().nullable(),
})

export const ListArtifactsOutputSchema = z.object({
	artifacts: z.array(ArtifactListItemSchema),
})

export const listArtifactsContract = contractBuilder.input(ListArtifactsInputSchema).output(ListArtifactsOutputSchema)
