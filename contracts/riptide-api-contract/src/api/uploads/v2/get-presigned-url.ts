import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { safeSubpathSchema } from '../../../lib/filename-validation'

export const GetPresignedUrlV2InputSchema = z.object({
	taskId: z.uuidv7().describe('The future or existing task to generate an upload URL for'),
	fileName: safeSubpathSchema.describe('The task-relative path of the file to upload'),
	contentType: z.string().trim().min(1).max(255).describe('MIME type of the file'),
})

export const GetPresignedUrlV2OutputSchema = z.object({
	uploadUrl: z.string().describe('Pre-signed S3 PUT URL for direct upload'),
})

export const getPresignedUrlV2Contract = contractBuilder
	.input(GetPresignedUrlV2InputSchema)
	.output(GetPresignedUrlV2OutputSchema)
