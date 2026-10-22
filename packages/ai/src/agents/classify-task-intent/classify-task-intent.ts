import type { LanguageModelV3 } from '@ai-sdk/provider'
import { TaskIntentSchema, type TaskIntent } from '@humanlayer/schemas/task-intent'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'

const ClassificationSchema = z.object({ intent: TaskIntentSchema })

const classificationPrompt = (text: string) => `Classify the user's coding task by its primary intent.

Return exactly one intent:
- research: The user wants to explore, understand, inspect, debug, query, fetch, or gather facts. This includes questions, checking logs, fetching an issue, and investigating a bug without asking for a fix.
- design: The user asks to plan, design, spec, or decide how to make a change, but does not ask to make the change yet.
- implementation: The user asks to change code or behavior. This includes fixing, updating, adding, removing, building, refactoring, or implementing something.
- unknown: The request has too little information, is ambiguous, or does not fit either class.

If the request asks both to investigate or plan and to make a change, choose implementation.

User task:
---
${text}
---`

export async function classifyTaskIntent(
	text: string,
	{ model = resolveModel('haiku') }: { model?: LanguageModelV3 } = {},
): Promise<TaskIntent> {
	if (!text.trim()) return 'unknown'

	const { output } = await generateText({
		model,
		maxRetries: 0,
		prompt: classificationPrompt(text),
		output: Output.object({ schema: ClassificationSchema }),
		providerOptions: { openai: { strictJsonSchema: false } },
	})

	if (!output) throw new Error('Task intent classifier returned no output')
	return output.intent
}
