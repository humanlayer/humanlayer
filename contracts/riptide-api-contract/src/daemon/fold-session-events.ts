import z from 'zod/v4'

import { contractBuilder } from '../contract-builder'

export const FoldSessionEventSchema = z
	.object({
		seq: z.number().int().nonnegative(),
		eventId: z.string().min(1),
		ts: z.number().int().nonnegative(),
		version: z.number().int().positive(),
	})
	.passthrough()

export const FoldSessionEventEntrySchema = z
	.object({
		seq: z.number().int().nonnegative(),
		eventId: z.string().min(1),
		ts: z.number().int().nonnegative(),
		event: FoldSessionEventSchema,
	})
	.superRefine((entry, context) => {
		for (const field of ['seq', 'eventId', 'ts'] as const) {
			if (entry[field] !== entry.event[field]) {
				context.addIssue({
					code: 'custom',
					path: ['event', field],
					message: `event.${field} must match ${field}`,
				})
			}
		}
	})

export const AppendFoldSessionEventInputSchema = z.object({
	sessionId: z.uuid(),
	entry: FoldSessionEventEntrySchema,
})

export const AppendFoldSessionEventOutputSchema = z.object({
	entry: FoldSessionEventSchema,
})

export const appendFoldSessionEventContract = contractBuilder
	.input(AppendFoldSessionEventInputSchema)
	.output(AppendFoldSessionEventOutputSchema)

export const ListFoldSessionEventsInputSchema = z.object({
	sessionId: z.uuid(),
})

export const ListFoldSessionEventsOutputSchema = z.object({
	entries: z.array(FoldSessionEventSchema),
})

export const listFoldSessionEventsContract = contractBuilder
	.input(ListFoldSessionEventsInputSchema)
	.output(ListFoldSessionEventsOutputSchema)
