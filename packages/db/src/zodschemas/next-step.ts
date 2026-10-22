import z from 'zod/v4'

/**
 * Discriminated union for AI extraction output
 * Matches the structure from the design discussion
 */
export const NextStepAiOutputSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('next_step_found'),
		nextStepPrompt: z.string().describe('The full prompt text from the code block'),
		nextStepSummary: z.string().describe('Short button label like "Proceed to Structure Phase"'),
		nextStepType: z
			.enum([
				'create-research-questions',
				'create-research',
				'create-design-discussion',
				'create-prd',
				'create-tdd',
				'create-structure-outline',
				'create-plan',
				'implement-plan',
				'implement-outline',
				'setup-worktree',
				'iterate-research-questions',
				'iterate-research',
				'iterate-design-discussion',
				'iterate-structure-outline',
				'iterate-plan',
				'iterate-implementation',
				'describe-pr',
				'other',
			])
			.describe('The RPI skill name being suggested'),
		taskReference: z
			.string()
			.describe('Task identifier like "eng-1234-feature" or "ll-31-riptide-next-session-suggestions"'),
		suggestedDirectory: z
			.string()
			.optional()
			.describe('Directory to run the prompt in, if mentioned (e.g., "~/wt/project-name")'),
	}),
	z.object({
		type: z.literal('no_next_step'),
		reason: z.string().describe('Why no next step was found'),
	}),
])

/**
 * Wrapper with metadata for storage
 */
export const NextStepSuggestionSchema = z.object({
	parsedAt: z.number().describe('Unix timestamp (ms) when extraction was performed'),
	extraction: NextStepAiOutputSchema.describe('The AI extraction result'),
	extractionError: z.string().optional().describe('Error message if extraction failed'),
})

export type NextStepAiOutput = z.infer<typeof NextStepAiOutputSchema>
export type NextStepSuggestion = z.infer<typeof NextStepSuggestionSchema>
