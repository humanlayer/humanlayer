import type { Context7Library } from '../../src/agents/doc-researcher/types'

export interface EvalQuestion {
	slug: string // e.g., "001-orpc-middleware" for directory naming
	question: string // The actual question to evaluate
	category: string // e.g., "oRPC", "Electric SQL", "Claude Agent SDK"
	packageName: string // e.g., "@orpc/server", "drizzle-orm" - the canonical package name
	language: string // e.g., "typescript", "rust"
	answer: string // Reference answer for judging
}

export interface ExaEvalResult {
	rawResponse: string
	requestId: string
	resultsCount: number
	outputTokens: number
	searchTimeMs: number
}

export interface Context7EvalResult {
	rawResponse: string
	selectedLibrary: Context7Library
	librariesConsidered: Context7Library[]
}

export interface SummarizedAnswer {
	answer: string
	keyPoints: string[]
	codeSnippets: string
	confidence: 'high' | 'moderate' | 'low'
}

/**
 * Simplified judgment using 1-4 scale:
 * 1 = Not helpful - answer is wrong or irrelevant
 * 2 = Somewhat correct - has some right info but missing key details
 * 3 = Mostly correct - good answer with minor omissions
 * 4 = Exactly correct - contains all necessary information
 */
export interface JudgmentResult {
	winner: 'exa' | 'context7' | 'tie'
	reasoning: string
	exaScore: 1 | 2 | 3 | 4
	context7Score: 1 | 2 | 3 | 4
}

export interface EvalResult {
	question: EvalQuestion
	exaResult: ExaEvalResult
	context7Result: Context7EvalResult
	exaSummary: SummarizedAnswer
	context7Summary: SummarizedAnswer
	rawJudgment: JudgmentResult
	summaryJudgment: JudgmentResult
}
