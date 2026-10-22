import z from 'zod/v4'

export const LearnQuestionSchema = z.object({
	question: z.string().describe('The quiz question'),
	context: z.string().optional().describe('Optional background context shown above the question'),
	options: z
		.array(
			z.object({
				label: z
					.string()
					.describe(
						'The option content as a markdown snippet — can be plain text, or include fenced code blocks, inline code, or mermaid diagrams.',
					),
			}),
		)
		.describe('2-4 answer options'),
	correctIndex: z.number().describe('0-based index of the correct option'),
	explanation: z.string().describe('Why the correct answer is correct, shown after answering'),
})

export const LearnQuestionSetSchema = z.object({
	hasQuestions: z.boolean().describe('Whether questions could be generated from the content'),
	reason: z.string().optional().describe('Why no questions could be generated'),
	questions: z.array(LearnQuestionSchema).optional(),
	generatedAt: z.number().describe('Unix timestamp (ms) when questions were generated'),
})

export type LearnQuestion = z.infer<typeof LearnQuestionSchema>
export type LearnQuestionSet = z.infer<typeof LearnQuestionSetSchema>
