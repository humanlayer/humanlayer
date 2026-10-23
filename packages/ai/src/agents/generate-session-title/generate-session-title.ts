import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'

const titleGenerationPrompt = (ticketPrefix: string, prompt: string, taskName?: string | null) =>
	`You are generating a short, descriptive title for a coding session based on the user's initial prompt.

Rules:
- Generate a title that is 3-7 words long
- The title should capture the essence of what the user is trying to do
- Use title case (capitalize major words)
- Do NOT include quotes around the title
- Do NOT include a period at the end
- Be specific and descriptive, not generic
- Preserve acronyms and shorthand from the prompt exactly as written; never change their case, expand, translate, or infer their meaning (e.g. "API" stays "API" and "sdk" stays "sdk")
- If the prompt mentions an rpi:SKILLNAME skill, the title MUST start with "SKILLNAME: ", using the exact skill name without the "rpi:" prefix (e.g. "create-plan: Draft Auth Migration Plan")
- The rpi skill prefix takes priority over all other prefix rules, including a ticket ID
${ticketPrefix}${
		taskName
			? `- Use the task name to understand what the session is about, but still include the required rpi skill prefix when the prompt mentions one.

<task_name>${taskName}</task_name>
`
			: ''
	}
User's prompt:
---
${prompt}
---`

const TitleSchema = z.object({
	title: z.string().describe('A short 3-7 word title for the coding session'),
})

export async function generateSessionTitle(
	prompt: string,
	ticketId?: string | null,
	taskName?: string | null,
	{ model = resolveModel('haiku') }: { model?: LanguageModelV3 } = {},
): Promise<string> {
	const ticketPrefix = ticketId
		? `- Prefix the title with "${ticketId}: " (e.g. "${ticketId}: Fix Auth Login Bug")\n`
		: ''

	const { output } = await generateText({
		model,
		maxRetries: 0,
		prompt: titleGenerationPrompt(ticketPrefix, prompt, taskName),
		output: Output.object({
			schema: TitleSchema,
		}),
		providerOptions: { openai: { strictJsonSchema: false } },
	})

	return output?.title ?? 'Untitled Session'
}
