import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { safeSubpathSchema } from '../../lib/filename-validation'

export const DaemonCreateUploadInputSchema = z.object({
	taskId: z.uuid(),
	fileName: safeSubpathSchema,
	contentType: z.string().min(1),
	contentHash: z.string().min(1),
	fileSizeBytes: z.number().int().positive(),
})

export const DaemonCreateUploadOutputSchema = z.object({
	artifactId: z.uuid(),
	uploadUrl: z.string(),
	transactionId: z.string(),
})

export const daemonCreateUploadContract = contractBuilder
	.input(DaemonCreateUploadInputSchema)
	.output(DaemonCreateUploadOutputSchema)
