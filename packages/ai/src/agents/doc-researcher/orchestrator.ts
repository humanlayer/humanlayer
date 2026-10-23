/**
 * Documentation Research Orchestrator
 * Combines concurrent fetching with AI synthesis to produce final response.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import { resolveModel } from '../../providers'
import { fetchDocumentation } from './dual-source-fetcher'
import { formatSearchResults } from './format-results'
import type { DocumentationResearchResult, ResearchDocumentationInput } from './types'

const SYSTEM_PROMPT = `You are a documentation research assistant that helps developers find accurate information about programming libraries and packages.

You receive search results from two independent documentation sources. Your job is to:
1. Evaluate whether the results are relevant to the specified package
2. Determine if the results adequately answer the question
3. Synthesize a clear, helpful response

CRITICAL RULES:
- NEVER mention search methods, sources, or that multiple sources were used
- NEVER reference "search_results_a", "search_results_b", or any internal process
- Your response should appear as unified, authoritative documentation
- If results are ambiguous, incomplete, or potentially for the wrong library, ask for clarification
- When answering, provide clear explanations with code examples when relevant

Decision criteria:
- Results clearly match the library AND answer the question → canAnswer: true, provide comprehensive answer
- Results are ambiguous, incomplete, or for wrong library → canAnswer: false, ask clarifying question`

const DocumentationResearchOutputSchema = z.object({
	canAnswer: z
		.boolean()
		.describe(
			'True if the search results provide enough relevant information to confidently ' +
				'answer the question for the specified package. False if results are ambiguous, ' +
				'incomplete, potentially for wrong library, or insufficient to answer.',
		),
	response: z
		.string()
		.describe(
			'If canAnswer is true: A comprehensive markdown response with explanation and code snippets. ' +
				'If canAnswer is false: A helpful message asking the user for clarification ' +
				'(e.g., which specific library version, more context about the use case, more precise question).',
		),
})

/**
 * Research documentation for a library to answer a developer question.
 * Fetches from multiple sources, synthesizes results, and returns either
 * a confident answer or a request for clarification.
 */
export async function researchDocumentation(
	input: ResearchDocumentationInput,
	{ model = resolveModel('sonnet') }: { model?: LanguageModelV3 } = {},
): Promise<DocumentationResearchResult> {
	const { question, packageName, language } = input

	// Step 1: Concurrent fetch from both sources
	const { exaResult, context7Result } = await fetchDocumentation(question, packageName, language)

	// Step 2: Format results for AI consumption
	const formattedResults = formatSearchResults(exaResult, context7Result)

	// Step 3: AI orchestration to produce final response
	const prompt = `Package: ${packageName}
Question: ${question}

Search Results:
${formattedResults}

Analyze these results and provide your response.`

	const { output } = await generateText({
		model,
		maxRetries: 0,
		system: SYSTEM_PROMPT,
		prompt,
		output: Output.object({ schema: DocumentationResearchOutputSchema }),
		providerOptions: { openai: { strictJsonSchema: false } },
	})

	// Step 4: Convert AI output to discriminated union
	if (output.canAnswer) {
		return { type: 'answer', content: output.response }
	} else {
		return { type: 'need_more_info', message: output.response }
	}
}
