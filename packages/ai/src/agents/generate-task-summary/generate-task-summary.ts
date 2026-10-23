import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'

const taskSummaryPrompt = (description: string) =>
	`You are generating a short, descriptive title for a coding task based on the user's description of what they want to build.

Rules:
- Generate a title that is 3-10 words long
- The title should capture the essence of what the user is trying to build or accomplish
- Use title case (capitalize major words)
- Do NOT include quotes around the title
- Do NOT include a period at the end
- Be specific and descriptive, not generic (e.g. "Add Dark Mode Toggle to Settings" not "New Feature")
- Focus on the WHAT, not the HOW
- Preserve acronyms and shorthand from the description exactly as written; never change their case, expand, translate, or infer their meaning (e.g. "API" stays "API" and "sdk" stays "sdk")

User's task description:
---
${description}
---`

const TaskSummarySchema = z.object({
	title: z.string().describe('A short 3-10 word title for the coding task'),
})

export async function generateTaskSummary(
	description: string,
	{ model = resolveModel('haiku') }: { model?: LanguageModelV3 } = {},
): Promise<string> {
	const { output } = await generateText({
		model,
		maxRetries: 0,
		prompt: taskSummaryPrompt(description),
		output: Output.object({
			schema: TaskSummarySchema,
		}),
		providerOptions: { openai: { strictJsonSchema: false } },
	})

	return output?.title ?? 'Untitled Task'
}
