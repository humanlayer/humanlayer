import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const HandoffSessionInputSchema = z.object({
	id: z.uuidv7().optional().describe('Client-generated session ID for optimistic insert'),
	eventId: z.uuidv7().optional().describe('Client-generated event ID for optimistic insert'),
	sourceSessionId: z.uuidv7().describe('The session to hand off from'),
	codingAgent: CodingAgentZodSchema.extract(['claude', 'codelayer']).describe('The coding agent to hand off to'),
	provider: z.string().describe('Provider for the destination session'),
	model: z.string().describe('Model for the destination session'),
	effort: z.string().nullable().optional().describe('Reasoning effort for the destination session'),
	fastMode: z.boolean().optional().describe('Fast mode for the destination session'),
	includeToolCalls: z
		.boolean()
		.default(true)
		.describe('Include tool calls and results in the transferred transcript'),
	title: z.string().nullable().default(null).describe('Title for the destination session'),
})

export const HandoffSessionOutputSchema = z.object({
	transactionId: z.string(),
	session: sessionSelectSchema,
})

const handoffErrors = {
	HANDOFF_FAILED: {
		status: StatusCodes.UNPROCESSABLE_ENTITY,
		data: z.object({
			message: z.string(),
		}),
	},
}

export const handoffSessionContract = contractBuilder
	.input(HandoffSessionInputSchema)
	.output(HandoffSessionOutputSchema)
	.errors(handoffErrors)
