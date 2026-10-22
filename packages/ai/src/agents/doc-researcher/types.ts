/**
 * Types for the doc-researcher agent.
 * All types specific to this agent live here to avoid cross-pollination.
 */

export interface DualSourceResult {
	exaResult: string | null
	context7Result: string | null
}

export interface Context7Library {
	id: string
	title: string
	totalSnippets?: number
	totalTokens?: number
	trustScore?: number
	benchmarkScore?: number
	description?: string
	branch?: string
	lastUpdateDate?: string
	state?: string
	stars?: number
	versions?: string[]
	score?: number
	vip?: boolean
}

export interface Context7SearchResponse {
	results: Context7Library[]
}

export interface Context7ContextResponse {
	snippets?: Array<{ title?: string; content: string; source?: string }>
	context?: string
	libraryId?: string
}

export interface ExaContextRequest {
	query: string
	tokensNum?: number | 'dynamic'
}

export interface ExaContextResponse {
	requestId: string
	query: string
	response: string
	resultsCount: number
	costDollars: { total: number }
	searchTime: number
	outputTokens: number
}

export type DocumentationResearchResult =
	| { type: 'answer'; content: string }
	| { type: 'need_more_info'; message: string }

export interface ResearchDocumentationInput {
	question: string
	packageName: string
	language: string
}
