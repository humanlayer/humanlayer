import type { LanguageModelV3 } from '@ai-sdk/provider'

import { exaContext } from '../../src/agents/doc-researcher/exa-client'
import { searchContext7WithResolution } from './context7-resolver'
import { judgeRawOutputs, judgeSummarizedAnswers } from './judge'
import { summarizeForQuestion } from './summarizer'
import type { EvalQuestion, EvalResult, ExaEvalResult } from './types'

export interface RunEvaluationOptions {
	model?: LanguageModelV3
}

export async function runEvaluation(question: EvalQuestion, _opts?: RunEvaluationOptions): Promise<EvalResult> {
	console.log(`\n[${question.slug}] Starting evaluation...`)

	// Step 1: Call both APIs in parallel
	console.log(`  → Calling Exa + Context7 APIs...`)
	const [exaResponse, context7Result] = await Promise.all([
		exaContext({ query: question.question, tokensNum: 5000 }),
		searchContext7WithResolution(question),
	])

	const exaResult: ExaEvalResult = {
		rawResponse: exaResponse.response,
		requestId: exaResponse.requestId,
		resultsCount: exaResponse.resultsCount,
		outputTokens: exaResponse.outputTokens,
		searchTimeMs: exaResponse.searchTime,
	}

	// Step 2: Summarize both responses in parallel
	console.log(`  → Summarizing responses...`)
	const [exaSummary, context7Summary] = await Promise.all([
		summarizeForQuestion(exaResult.rawResponse, question.question),
		summarizeForQuestion(context7Result.rawResponse, question.question),
	])

	// Step 3: Judge both modes in parallel
	console.log(`  → Judging (Opus)...`)
	const [rawJudgment, summaryJudgment] = await Promise.all([
		judgeRawOutputs(question.question, question.answer, exaResult.rawResponse, context7Result.rawResponse),
		judgeSummarizedAnswers(question.question, question.answer, exaSummary, context7Summary),
	])

	console.log(`  ✓ Complete: Raw winner=${rawJudgment.winner}, Summary winner=${summaryJudgment.winner}`)

	return {
		question,
		exaResult,
		context7Result,
		exaSummary,
		context7Summary,
		rawJudgment,
		summaryJudgment,
	}
}

// Run evaluations with concurrency limit
export async function runAllEvaluations(
	questions: EvalQuestion[],
	concurrency = 3,
	opts?: RunEvaluationOptions,
): Promise<EvalResult[]> {
	const results: EvalResult[] = []

	// Process in batches
	for (let i = 0; i < questions.length; i += concurrency) {
		const batch = questions.slice(i, i + concurrency)
		const batchResults = await Promise.all(
			batch.map(async (question) => {
				try {
					return await runEvaluation(question, opts)
				} catch (error) {
					console.error(`[${question.slug}] Failed:`, error)
					return null
				}
			}),
		)
		results.push(...batchResults.filter((r): r is EvalResult => r !== null))
	}

	return results
}
