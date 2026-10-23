import z from 'zod/v4'

/**
 * Schema for AI-extracted session summary
 * Uses .describe() annotations to guide AI extraction
 */
export const SessionSummarySchema = z.object({
	summaryHistory: z
		.array(z.string())
		.describe('Bullet points summarizing what happened in the session - key actions, decisions, and outcomes'),
	relevantTasks: z
		.array(z.string())
		.optional()
		.describe('Task directories mentioned, e.g. rpi/tasks/core-1234-description'),
	relevantRPIDocuments: z
		.array(
			z.object({
				localpath: z.string().describe('Local file path like rpi/tasks/core-52/research.md'),
				permalink: z.string().optional().describe('GitHub permalink if explicitly mentioned'),
			}),
		)
		.optional()
		.describe('Files in rpi/tasks/... that are relevant to the session'),
})

export type SessionSummary = z.infer<typeof SessionSummarySchema>
