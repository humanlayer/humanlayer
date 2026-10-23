import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'

export const CreateUploadInputSchema = z.object({
	taskId: z.uuid().describe('The task to associate this upload with'),
	fileName: safeSubpathSchema.describe('The file name of the uploaded file'),
	contentType: z.string().min(1).describe('MIME type of the file'),
	contentHash: z.string().min(1).describe('SHA-256 hash of the file bytes, hex-encoded'),
	fileSizeBytes: z.number().int().positive().describe('File size in bytes'),
})

export const CreateUploadOutputSchema = z.object({
	artifactId: z.uuid(),
	transactionId: z.string(),
})

export const createUploadContract = contractBuilder.input(CreateUploadInputSchema).output(CreateUploadOutputSchema)
