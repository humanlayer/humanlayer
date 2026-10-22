import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetDownloadUrlInputSchema = z.object({
	artifactId: z.uuid().describe('The artifact ID to get a download URL for'),
})

export const GetDownloadUrlOutputSchema = z.object({
	downloadUrl: z.string().describe('Pre-signed S3 GET URL'),
})

export const getDownloadUrlContract = contractBuilder
	.input(GetDownloadUrlInputSchema)
	.output(GetDownloadUrlOutputSchema)
