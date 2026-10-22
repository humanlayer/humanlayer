import { anthropic } from '@ai-sdk/anthropic'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import type { SummarizedAnswer } from './types'

const SummarySchema = z.object({
	answer: z.string().describe('A clear, concise answer to the question based on the documentation'),
	keyPoints: z
		.array(z.string())
		.describe('3-5 key points from the documentation (up to 12 if necessary for complex topics)'),
	codeSnippets: z
		.string()
		.describe(
			'Code snippets that demonstrate the answer. REQUIRED for technical questions. Include complete, runnable examples with imports.',
		),
	confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the answer quality'),
})

export async function summarizeForQuestion(rawResponse: string, question: string): Promise<SummarizedAnswer> {
	const prompt = `You are summarizing documentation search results to answer a developer's question.

Question: ${question}

Documentation retrieved:
---
${rawResponse}
---

Extract and provide:

1. **Answer**: A clear, direct answer to the question

2. **Key Points**: 3-5 key points from the documentation (up to 12 for complex topics)

3. **Code Snippets**: THIS IS CRITICAL - You MUST include code examples that demonstrate the answer.
   - Include complete, runnable code snippets extracted from the documentation
   - For "how do I" questions, code examples are REQUIRED
   - Include import statements and setup code when relevant

4. **Confidence**: Your confidence level in the answer quality

If the documentation does not contain relevant code examples for a technical question, set confidence to "low".`

	const { output } = await generateText({
		model: anthropic('claude-sonnet-5'),
		prompt,
		output: Output.object({ schema: SummarySchema }),
	})

	return output as SummarizedAnswer
}
