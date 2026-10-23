import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ForkSessionInputSchema = z.object({
	id: z.uuidv7().optional().describe('Client-generated session ID for optimistic insert'),
	eventId: z.uuidv7().optional().describe('Client-generated event ID for optimistic insert'),
	sourceSessionId: z.uuidv7().describe('The session to fork from'),
	forkAtEventId: z.uuidv7().describe('Conversation event ID of the selected user message fork point'),
	text: z.string().describe('Prompt for the forked session'),
	title: z.string().nullable().default(null).describe('Title for the forked session'),
	archiveSource: z.boolean().default(false).describe('Whether to archive the source session on fork'),
})

export const ForkSessionOutputSchema = z.object({
	transactionId: z.string(),
	session: sessionSelectSchema,
})

export const ForkSessionV2InputSchema = z.discriminatedUnion('codingAgent', [
	ForkSessionInputSchema.extend({ codingAgent: CodingAgentZodSchema.extract(['claude']) }),
	ForkSessionInputSchema.extend({ codingAgent: CodingAgentZodSchema.extract(['codelayer']) }),
	ForkSessionInputSchema.extend({ codingAgent: CodingAgentZodSchema.extract(['fold']) }),
])

export const LegacyClaudeForkMetadataSchema = z.object({
	forkFromCodingAgentSessionId: z.string().min(1),
	forkAtCodingAgentEventId: z.string().min(1),
})

export const CodelayerForkMetadataSchema = z.object({
	agent: CodingAgentZodSchema.extract(['codelayer']),
	sourceSessionId: z.uuidv7(),
	forkAtEventId: z.uuidv7(),
	forkAtRunIndex: z.number().int().nonnegative(),
	sourceSnapshotRunIndex: z.number().int().nonnegative(),
})

export const FoldForkMetadataSchema = z.object({
	agent: CodingAgentZodSchema.extract(['fold']),
	sourceSessionId: z.uuidv7(),
	forkAtEventId: z.uuidv7(),
	sourceFoldEventId: z.string().min(1),
	sourceFoldSeq: z.number().int().nonnegative(),
	childFoldSessionId: z.string().min(1),
})

export const StoredForkMetadataSchema = z.union([
	LegacyClaudeForkMetadataSchema,
	CodelayerForkMetadataSchema,
	FoldForkMetadataSchema,
])

const forkErrors = {
	FORK_FAILED: {
		status: StatusCodes.UNPROCESSABLE_ENTITY,
		data: z.object({
			message: z.string(),
		}),
	},
}

export const forkSessionContract = contractBuilder
	.input(ForkSessionInputSchema)
	.output(ForkSessionOutputSchema)
	.errors(forkErrors)

export const forkSessionV2Contract = contractBuilder
	.input(ForkSessionV2InputSchema)
	.output(ForkSessionOutputSchema)
	.errors(forkErrors)
