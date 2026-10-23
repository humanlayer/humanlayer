import z from 'zod/v4'

export const AccessRequestInitialEmailAttemptSchema = z.object({
	requestGeneration: z.number().int().positive(),
	adminUserId: z.string(),
	adminEmail: z.email(),
	resendEmailId: z.string().optional(),
	sentAt: z.iso.datetime().optional(),
	error: z.string().optional(),
})

export const AccessRequestScheduledReminderSchema = z.object({
	requestGeneration: z.number().int().positive(),
	adminUserId: z.string(),
	adminEmail: z.email(),
	resendEmailId: z.string(),
	scheduledAt: z.iso.datetime(),
	canceledAt: z.iso.datetime().optional(),
	cancelError: z.string().optional(),
})

export const AccessRequestInitialEmailAttemptsSchema = z.array(AccessRequestInitialEmailAttemptSchema)
export const AccessRequestScheduledRemindersSchema = z.array(AccessRequestScheduledReminderSchema)

export type AccessRequestInitialEmailAttempts = z.infer<typeof AccessRequestInitialEmailAttemptsSchema>
export type AccessRequestScheduledReminders = z.infer<typeof AccessRequestScheduledRemindersSchema>
