import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const SharedArtifactDownloadUrlInputSchema = z.object({
	artifactId: z.uuid(),
	shareKey: z.string().min(1),
})

export const SharedArtifactDownloadUrlOutputSchema = z.object({
	downloadUrl: z.string().describe('Pre-signed S3 GET URL'),
})

export const sharedArtifactDownloadUrlContract = contractBuilder
	.input(SharedArtifactDownloadUrlInputSchema)
	.output(SharedArtifactDownloadUrlOutputSchema)
