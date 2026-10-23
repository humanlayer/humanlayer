import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetDaemonDownloadUrlInputSchema = z.object({
	artifactId: z.uuid().describe('The artifact ID to download'),
})

export const GetDaemonDownloadUrlOutputSchema = z.object({
	downloadUrl: z.string().describe('Pre-signed S3 GET URL'),
})

export const getDaemonDownloadUrlContract = contractBuilder
	.input(GetDaemonDownloadUrlInputSchema)
	.output(GetDaemonDownloadUrlOutputSchema)
