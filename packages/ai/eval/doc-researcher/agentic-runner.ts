/**
 * Agentic Documentation Search Runner
 *
 * Two variants:
 * 1. Agent + Summary: Tool returns summarized answer, agent decides if good enough
 * 2. Agent + Raw: Tool returns raw search results, agent synthesizes and decides
 *
 * Both use Exa as the search backend.
 */
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, stepCountIs, tool } from 'ai'
import z from 'zod/v4'

import { exaContext } from '../../src/agents/doc-researcher/exa-client'
import { summarizeForQuestion } from './summarizer'
import type { EvalQuestion, SummarizedAnswer } from './types'

// Schema for the final answer
const AnswerSchema = z.object({
	answer: z.string().describe('The comprehensive answer to the question'),
	codeSnippets: z.string().describe('Code examples that demonstrate the answer'),
	confidence: z.enum(['high', 'moderate', 'low']).describe('Confidence in the answer'),
	searchAttempts: z.number().describe('Number of searches performed'),
})

// Schema for search
const SearchSchema = z.object({
	refinementReason: z.string().optional().describe('Why this search differs from previous attempts'),
	query: z.string().describe('The search query - be specific and include package names'),
})

export interface AgenticResult {
	answer: SummarizedAnswer
	searchAttempts: number
	totalSteps: number
	queries: string[]
	tokensUsed: number
}

const AGENT_SYSTEM_PROMPT = `You are a documentation research agent. Your goal is to find accurate, complete information to answer developer questions.

Strategy:
1. Start with a specific search query based on the question (include package names like @orpc/server, drizzle-orm, etc.)
2. Analyze the search results carefully
3. If results don't fully answer the question or are missing code examples, refine your search
4. When you have enough information with code examples, call the 'answer' tool

Important:
- Technical questions REQUIRE code examples in your answer
- If your first search doesn't include code, search again with terms like "example", "tutorial", or "how to"
- Be thorough but efficient - don't search more than necessary
- You have a maximum of 4 search attempts before you must provide an answer`

/**
 * Variant A: Agent sees summarized results from each search
 */
export async function runAgenticWithSummary(
	question: EvalQuestion,
	{ model = anthropic('claude-sonnet-5') as LanguageModelV3 }: { model?: LanguageModelV3 } = {},
): Promise<AgenticResult> {
	const queries: string[] = []

	const searchTool = tool({
		description: 'Search documentation. Returns a summarized answer with key points and code snippets.',
		inputSchema: SearchSchema,
		execute: async ({ query, refinementReason }) => {
			queries.push(query)
			console.log(`    [Search ${queries.length}] "${query}"${refinementReason ? ` (${refinementReason})` : ''}`)

			const raw = await exaContext({ query, tokensNum: 5000 })
			const summary = await summarizeForQuestion(raw.response, question.question)

			return {
				query,
				answer: summary.answer,
				keyPoints: summary.keyPoints,
				codeSnippets: summary.codeSnippets,
				confidence: summary.confidence,
				resultCount: raw.resultsCount,
			}
		},
	})

	// Answer tool has no execute - calling it stops the loop
	const answerTool = tool({
		description:
			'Call this when you have gathered enough information to provide a complete answer with code examples',
		inputSchema: AnswerSchema,
	})

	const { steps, usage } = await generateText({
		model,
		system: AGENT_SYSTEM_PROMPT,
		tools: {
			search: searchTool,
			answer: answerTool,
		},
		toolChoice: 'required',
		stopWhen: stepCountIs(5),
		onStepFinish: ({ toolCalls }) => {
			if (toolCalls && toolCalls.length > 0) {
				const toolName = toolCalls[0]?.toolName
				if (toolName === 'answer') {
					console.log(`    [Answer] Agent is ready to respond`)
				}
			}
		},
		prompt: question.question,
	})

	// Extract the final answer from answer tool call
	const answerCall = steps.flatMap((s) => s.toolCalls).find((tc) => tc.toolName === 'answer')

	// Try both 'args' and 'input' as the AI SDK may use either
	const answerArgs = answerCall
		? ((answerCall as Record<string, unknown>).args ?? (answerCall as Record<string, unknown>).input)
		: undefined

	if (answerArgs && typeof answerArgs === 'object') {
		const args = answerArgs as z.infer<typeof AnswerSchema>
		return {
			answer: {
				answer: args.answer,
				keyPoints: [],
				codeSnippets: args.codeSnippets,
				confidence: args.confidence,
			},
			searchAttempts: queries.length,
			totalSteps: steps.length,
			queries,
			tokensUsed: usage?.totalTokens ?? 0,
		}
	}

	// Max steps reached without explicit answer - synthesize from last search
	const lastSearchResult = steps
		.flatMap((s) => s.toolResults)
		.filter((tr) => tr.toolName === 'search')
		.pop()

	if (lastSearchResult && 'result' in lastSearchResult && typeof lastSearchResult.result === 'object') {
		const result = lastSearchResult.result as { answer: string; codeSnippets: string; confidence: string }
		return {
			answer: {
				answer: result.answer || 'Could not find a complete answer',
				keyPoints: [],
				codeSnippets: result.codeSnippets || '',
				confidence: (result.confidence as 'high' | 'moderate' | 'low') || 'low',
			},
			searchAttempts: queries.length,
			totalSteps: steps.length,
			queries,
			tokensUsed: usage?.totalTokens ?? 0,
		}
	}

	return {
		answer: {
			answer: 'Could not find a complete answer within the allowed search attempts.',
			keyPoints: [],
			codeSnippets: '',
			confidence: 'low',
		},
		searchAttempts: queries.length,
		totalSteps: steps.length,
		queries,
		tokensUsed: usage?.totalTokens ?? 0,
	}
}

/**
 * Variant B: Agent sees raw search results
 */
export async function runAgenticWithRaw(
	question: EvalQuestion,
	{ model = anthropic('claude-sonnet-5') as LanguageModelV3 }: { model?: LanguageModelV3 } = {},
): Promise<AgenticResult> {
	const queries: string[] = []

	const searchTool = tool({
		description: 'Search documentation. Returns raw documentation excerpts and code examples.',
		inputSchema: SearchSchema,
		execute: async ({ query, refinementReason }) => {
			queries.push(query)
			console.log(`    [Search ${queries.length}] "${query}"${refinementReason ? ` (${refinementReason})` : ''}`)

			const raw = await exaContext({ query, tokensNum: 5000 })

			return {
				query,
				results: raw.response,
				resultCount: raw.resultsCount,
			}
		},
	})

	// Answer tool has no execute - calling it stops the loop
	const answerTool = tool({
		description:
			'Call this when you have gathered enough information to provide a complete answer with code examples',
		inputSchema: AnswerSchema,
	})

	const { steps, usage } = await generateText({
		model,
		system: AGENT_SYSTEM_PROMPT,
		tools: {
			search: searchTool,
			answer: answerTool,
		},
		toolChoice: 'required',
		stopWhen: stepCountIs(5),
		onStepFinish: ({ toolCalls }) => {
			if (toolCalls && toolCalls.length > 0) {
				const toolName = toolCalls[0]?.toolName
				if (toolName === 'answer') {
					console.log(`    [Answer] Agent is ready to respond`)
				}
			}
		},
		prompt: question.question,
	})

	// Extract the final answer from answer tool call
	const answerCall = steps.flatMap((s) => s.toolCalls).find((tc) => tc.toolName === 'answer')

	// Try both 'args' and 'input' as the AI SDK may use either
	const answerArgs = answerCall
		? ((answerCall as Record<string, unknown>).args ?? (answerCall as Record<string, unknown>).input)
		: undefined

	if (answerArgs && typeof answerArgs === 'object') {
		const args = answerArgs as z.infer<typeof AnswerSchema>
		return {
			answer: {
				answer: args.answer,
				keyPoints: [],
				codeSnippets: args.codeSnippets,
				confidence: args.confidence,
			},
			searchAttempts: queries.length,
			totalSteps: steps.length,
			queries,
			tokensUsed: usage?.totalTokens ?? 0,
		}
	}

	// Max steps reached - try to use last step's text output
	const lastStepText = steps[steps.length - 1]?.text || ''

	return {
		answer: {
			answer: lastStepText || 'Could not find a complete answer within the allowed search attempts.',
			keyPoints: [],
			codeSnippets: '',
			confidence: 'low',
		},
		searchAttempts: queries.length,
		totalSteps: steps.length,
		queries,
		tokensUsed: usage?.totalTokens ?? 0,
	}
}
