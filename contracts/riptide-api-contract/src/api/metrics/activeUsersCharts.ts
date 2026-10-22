import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ActiveUsersChartInputSchema = z.object({
	weeks: z.number().int().min(4).max(12).default(8),
	timezoneOffset: z.number().int().min(-840).max(720).default(0),
	limit: z.number().int().min(1).max(25).default(10),
})

export const ActiveUsersChartOutputSchema = z.object({
	generatedAt: z.string(),
	weekStarts: z.array(z.string()),
	users: z.array(
		z.object({
			userId: z.string(),
			displayName: z.string(),
			profilePictureUrl: z.string().optional(),
			values: z.array(z.number()),
			total: z.number(),
		}),
	),
})

export const activeUsersSessionsContract = contractBuilder
	.input(ActiveUsersChartInputSchema)
	.output(ActiveUsersChartOutputSchema)

export const activeUsersCommentsContract = contractBuilder
	.input(ActiveUsersChartInputSchema)
	.output(ActiveUsersChartOutputSchema)

export const activeUsersCollaborationOutboundContract = contractBuilder
	.input(ActiveUsersChartInputSchema)
	.output(ActiveUsersChartOutputSchema)

export const activeUsersCollaborationInboundContract = contractBuilder
	.input(ActiveUsersChartInputSchema)
	.output(ActiveUsersChartOutputSchema)
