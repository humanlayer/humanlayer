import z from 'zod/v4'

export const SlackAutomationEventTypeSchema = z.enum([
	'design-discussion',
	'design-prd',
	'design-tdd',
	'structure-outline',
	'comment',
])

export const SlackAutomationSchema = z.object({
	id: z.string(),
	name: z.string(),
	channelId: z.string(),
	channelName: z.string().nullable(),
	channelIsPrivate: z.boolean(),
	eventTypes: z.array(SlackAutomationEventTypeSchema),
	ownerUserIds: z.array(z.string()).nullable(),
	enabled: z.boolean(),
})

export const SlackAutomationInputSchema = SlackAutomationSchema.omit({ id: true })
