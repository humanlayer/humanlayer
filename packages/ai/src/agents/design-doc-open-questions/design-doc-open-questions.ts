import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'

const EXTRACTION_PROMPT = `Count the open vs resolved design questions in this design-discussion document.

Rules:
- Open questions are under "### Design Questions" section and do NOT have a ✅ or "Decision:" marker
- Resolved questions are marked with ✅ in the heading OR have a "Decision:" line OR are under "### Resolved Design Questions" section or otherwise have a _very clear_ indication that the user has indicated a decision.
- If Design Questions section says "(all resolved)" or similar, numOpenQuestions is 0
- Count each distinct question - these appear as #### subheadings (e.g., "#### Q1: Something", "#### Theme Name", "#### API Design") or numbered items under "### Design Questions"
- A "Recommendation:" line does NOT mean the question is resolved - only ✅ or "Decision:" marks resolution
- If a question is indicated as resolved in one place but its status may be ambiguous due to being listed as an open question somewhere else, you can consider it resolved - as long as it is marked as resolved in at LEAST once place.

<document>
{docContent}
</document>`

const DesignDocQuestionCountsSchema = z.object({
	numOpenQuestions: z.number().describe('Number of unresolved design questions'),
	numResolvedQuestions: z.number().describe('Number of resolved design questions'),
})

export type DesignDocQuestionCounts = z.infer<typeof DesignDocQuestionCountsSchema>

export async function inferDesignDocQuestionCounts(
	docContent: string,
	{ model = resolveModel('sonnet') }: { model?: LanguageModelV3 } = {},
): Promise<DesignDocQuestionCounts> {
	const prompt = EXTRACTION_PROMPT.replace('{docContent}', docContent)

	console.log('[inferDesignDocQuestionCounts] Counting design questions...')
	console.log(`[inferDesignDocQuestionCounts] Document length: ${docContent.length} chars`)

	const { output } = await generateText({
		model,
		maxRetries: 0,
		providerOptions: {
			anthropic: {
				thinking: { type: 'adaptive' },
				effort: 'medium',
			},
			openai: {
				reasoningEffort: 'medium',
				strictJsonSchema: false,
			},
		},
		prompt,
		output: Output.object({
			schema: DesignDocQuestionCountsSchema,
		}),
	})

	const result = output as DesignDocQuestionCounts
	console.log(
		`[inferDesignDocQuestionCounts] Result: ${result.numOpenQuestions} open, ${result.numResolvedQuestions} resolved`,
	)

	return result
}
