import { permissionsModeSchema } from '@humanlayer/db/tables/sessions'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ContinueSessionInputSchema = z.object({
	sessionId: z.uuid(),
	eventId: z.uuidv7().optional().describe('Client-generated event ID for optimistic inserts'),
	text: z.string().min(1, 'Message is required'),
	model: z.string().default('opus').describe('The model to use (e.g., opus, sonnet, haiku, or full model ID)'),
	effort: z.string().nullish().describe('The reasoning effort level'),
	fastMode: z.boolean().nullish().describe('Whether to enable Fast Mode'),
	permissionsMode: permissionsModeSchema.default('default'),
})

export const ContinueSessionOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const continueSessionContract = contractBuilder
	.input(ContinueSessionInputSchema)
	.output(ContinueSessionOutputSchema)
