import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ArchiveTaskInputSchema = z.object({
	taskId: z.uuidv7().describe('The task ID to archive/unarchive'),
	archived: z.boolean().describe('Whether to archive (true) or unarchive (false)'),
	cascadeToSessions: z.boolean().describe('Whether to cascade the archive status to associated sessions'),
})

export const ArchiveTaskOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
	affectedSessionCount: z.number().describe('Number of sessions that were archived/unarchived'),
})

export const archiveTaskContract = contractBuilder.input(ArchiveTaskInputSchema).output(ArchiveTaskOutputSchema)
