import z from 'zod/v4'

export const TicketProviderSchema = z.enum(['linear', 'jira', 'github'])

export type TicketProvider = z.infer<typeof TicketProviderSchema>
