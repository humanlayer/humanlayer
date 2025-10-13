import * as z from 'zod/v4'

export const ThoughtsOperationSchema = z.object({
	thoughtsDocumentId: z.string(),
	op: z.base64(), // binary encoded as base64
	clientId: z.string().optional(),
})

export const NewThoughtsDocumentRequestSchema = z.object({
	title: z.string(),
	filePath: z.string(),
	organizationId: z.string(),
})
