import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'

export const GetPresignedUrlInputSchema = z.object({
	taskId: z.uuid().describe('The task to generate an upload URL for'),
	fileName: safeSubpathSchema.describe('The file name of the file to upload'),
	contentType: z.string().min(1).describe('MIME type of the file'),
})

export const GetPresignedUrlOutputSchema = z.object({
	uploadUrl: z.string().describe('Pre-signed S3 PUT URL for direct upload'),
})

export const getPresignedUrlContract = contractBuilder
	.input(GetPresignedUrlInputSchema)
	.output(GetPresignedUrlOutputSchema)
