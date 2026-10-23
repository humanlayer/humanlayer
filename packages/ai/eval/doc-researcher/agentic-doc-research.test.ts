/**
 * Eval: Agentic Doc Research (Exa only)
 *
 * Compares three approaches:
 * 1. 1-shot: Single search + summarize (baseline)
 * 2. Agent + Summary: Agent loop where tool returns summarized results
 * 3. Agent + Raw: Agent loop where tool returns raw results
 *
 * Run with: bun --cwd packages/ai test src/eval/agentic-doc-research.test.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { describe, expect, test } from 'vitest'

import { exaContext } from '../../src/agents/doc-researcher/exa-client'
import { buildMatrix } from '../_lib/matrix'
import { type AgenticResult, runAgenticWithRaw, runAgenticWithSummary } from './agentic-runner'
import { EVAL_QUESTIONS } from './index'
import { judgeSummarizedAnswers } from './judge'
import { summarizeForQuestion } from './summarizer'
import type { EvalQuestion, JudgmentResult, SummarizedAnswer } from './types'

// 30 minutes for full suite

const EXA_API_KEY = process.env.EXA_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const OUTPUT_DIR = join(import.meta.dir, '../../eval-results-agentic')

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6' },
	openai: { label: 'openai-gpt-5', modelId: 'gpt-5' },
})

interface OneShotResult {
	answer: SummarizedAnswer
	tokensUsed: number
}

interface ComparisonResult {
	question: EvalQuestion
	oneShot: OneShotResult
	agentSummary: AgenticResult
	agentRaw: AgenticResult
	judgments: {
		oneShotVsSummary: JudgmentResult
		oneShotVsRaw: JudgmentResult
		summaryVsRaw: JudgmentResult
	}
}

async function runOneShot(question: EvalQuestion): Promise<OneShotResult> {
	const raw = await exaContext({ query: question.question, tokensNum: 5000 })
	const summary = await summarizeForQuestion(raw.response, question.question)
	return {
		answer: summary,
		tokensUsed: raw.outputTokens,
	}
}

async function runComparison(question: EvalQuestion, model: LanguageModelV3): Promise<ComparisonResult> {
	console.log(`\n[${question.slug}] Starting comparison...`)

	// Run all three approaches
	console.log(`  → Running 1-shot...`)
	const oneShot = await runOneShot(question)

	console.log(`  → Running Agent + Summary...`)
	const agentSummary = await runAgenticWithSummary(question, { model })

	console.log(`  → Running Agent + Raw...`)
	const agentRaw = await runAgenticWithRaw(question, { model })

	// Judge pairwise comparisons
	console.log(`  → Judging comparisons (Opus)...`)
	const [oneShotVsSummary, oneShotVsRaw, summaryVsRaw] = await Promise.all([
		judgeSummarizedAnswers(question.question, question.answer, oneShot.answer, agentSummary.answer),
		judgeSummarizedAnswers(question.question, question.answer, oneShot.answer, agentRaw.answer),
		judgeSummarizedAnswers(question.question, question.answer, agentSummary.answer, agentRaw.answer),
	])

	console.log(
		`  ✓ Scores: 1-shot=${oneShotVsSummary.exaScore}/4 (${oneShot.answer.confidence}), AgentSum=${oneShotVsSummary.context7Score}/4 (${agentSummary.searchAttempts} searches, ${agentSummary.answer.confidence}), AgentRaw=${oneShotVsRaw.context7Score}/4 (${agentRaw.searchAttempts} searches, ${agentRaw.answer.confidence})`,
	)

	return {
		question,
		oneShot,
		agentSummary,
		agentRaw,
		judgments: {
			oneShotVsSummary,
			oneShotVsRaw,
			summaryVsRaw,
		},
	}
}

async function writeComparisonResult(result: ComparisonResult, outputDir: string): Promise<void> {
	const questionDir = join(outputDir, result.question.slug)
	await mkdir(questionDir, { recursive: true })

	const content = `# ${result.question.question}

**Category**: ${result.question.category}

## Results Summary

| Approach | Score | Searches | Confidence |
|----------|-------|----------|------------|
| 1-shot | ${result.judgments.oneShotVsSummary.exaScore}/4 | 1 | ${result.oneShot.answer.confidence} |
| Agent + Summary | ${result.judgments.oneShotVsSummary.context7Score}/4 | ${result.agentSummary.searchAttempts} | ${result.agentSummary.answer.confidence} |
| Agent + Raw | ${result.judgments.oneShotVsRaw.context7Score}/4 | ${result.agentRaw.searchAttempts} | ${result.agentRaw.answer.confidence} |

## Queries Used

### Agent + Summary
${result.agentSummary.queries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

### Agent + Raw
${result.agentRaw.queries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

## Judgments

### 1-shot vs Agent + Summary
**Winner**: ${result.judgments.oneShotVsSummary.winner === 'exa' ? '1-shot' : result.judgments.oneShotVsSummary.winner === 'context7' ? 'Agent+Summary' : 'TIE'}
${result.judgments.oneShotVsSummary.reasoning}

### 1-shot vs Agent + Raw
**Winner**: ${result.judgments.oneShotVsRaw.winner === 'exa' ? '1-shot' : result.judgments.oneShotVsRaw.winner === 'context7' ? 'Agent+Raw' : 'TIE'}
${result.judgments.oneShotVsRaw.reasoning}

### Agent + Summary vs Agent + Raw
**Winner**: ${result.judgments.summaryVsRaw.winner === 'exa' ? 'Agent+Summary' : result.judgments.summaryVsRaw.winner === 'context7' ? 'Agent+Raw' : 'TIE'}
${result.judgments.summaryVsRaw.reasoning}

## Answers

### 1-shot Answer
${result.oneShot.answer.answer}

**Code Snippets**:
${result.oneShot.answer.codeSnippets || 'None'}

### Agent + Summary Answer
${result.agentSummary.answer.answer}

**Code Snippets**:
${result.agentSummary.answer.codeSnippets || 'None'}

### Agent + Raw Answer
${result.agentRaw.answer.answer}

**Code Snippets**:
${result.agentRaw.answer.codeSnippets || 'None'}
`

	await writeFile(join(questionDir, 'comparison.md'), content)
}

async function writeAggregateSummary(results: ComparisonResult[], outputDir: string): Promise<void> {
	// Calculate wins for each approach
	const oneShotWins = { vs_summary: 0, vs_raw: 0 }
	const agentSummaryWins = { vs_oneshot: 0, vs_raw: 0 }
	const agentRawWins = { vs_oneshot: 0, vs_summary: 0 }
	const ties = { oneshot_summary: 0, oneshot_raw: 0, summary_raw: 0 }

	let totalOneShotScore = 0
	let totalAgentSummaryScore = 0
	let totalAgentRawScore = 0
	let totalAgentSummarySearches = 0
	let totalAgentRawSearches = 0

	for (const r of results) {
		// 1-shot vs Agent+Summary
		if (r.judgments.oneShotVsSummary.winner === 'exa') oneShotWins.vs_summary++
		else if (r.judgments.oneShotVsSummary.winner === 'context7') agentSummaryWins.vs_oneshot++
		else ties.oneshot_summary++

		// 1-shot vs Agent+Raw
		if (r.judgments.oneShotVsRaw.winner === 'exa') oneShotWins.vs_raw++
		else if (r.judgments.oneShotVsRaw.winner === 'context7') agentRawWins.vs_oneshot++
		else ties.oneshot_raw++

		// Agent+Summary vs Agent+Raw
		if (r.judgments.summaryVsRaw.winner === 'exa') agentSummaryWins.vs_raw++
		else if (r.judgments.summaryVsRaw.winner === 'context7') agentRawWins.vs_summary++
		else ties.summary_raw++

		// Scores (using the pairwise comparisons)
		totalOneShotScore += r.judgments.oneShotVsSummary.exaScore
		totalAgentSummaryScore += r.judgments.oneShotVsSummary.context7Score
		totalAgentRawScore += r.judgments.oneShotVsRaw.context7Score

		totalAgentSummarySearches += r.agentSummary.searchAttempts
		totalAgentRawSearches += r.agentRaw.searchAttempts
	}

	const count = results.length

	const summary = `# Agentic Evaluation Summary

**Total Questions**: ${count}
**Date**: ${new Date().toISOString()}

## Approach Comparison

| Matchup | Winner | Count |
|---------|--------|-------|
| 1-shot vs Agent+Summary | 1-shot | ${oneShotWins.vs_summary} |
| 1-shot vs Agent+Summary | Agent+Summary | ${agentSummaryWins.vs_oneshot} |
| 1-shot vs Agent+Summary | Tie | ${ties.oneshot_summary} |
| 1-shot vs Agent+Raw | 1-shot | ${oneShotWins.vs_raw} |
| 1-shot vs Agent+Raw | Agent+Raw | ${agentRawWins.vs_oneshot} |
| 1-shot vs Agent+Raw | Tie | ${ties.oneshot_raw} |
| Agent+Summary vs Agent+Raw | Agent+Summary | ${agentSummaryWins.vs_raw} |
| Agent+Summary vs Agent+Raw | Agent+Raw | ${agentRawWins.vs_summary} |
| Agent+Summary vs Agent+Raw | Tie | ${ties.summary_raw} |

## Average Scores

| Approach | Avg Score | Avg Searches |
|----------|-----------|--------------|
| 1-shot | ${(totalOneShotScore / count).toFixed(2)}/4 | 1.00 |
| Agent + Summary | ${(totalAgentSummaryScore / count).toFixed(2)}/4 | ${(totalAgentSummarySearches / count).toFixed(2)} |
| Agent + Raw | ${(totalAgentRawScore / count).toFixed(2)}/4 | ${(totalAgentRawSearches / count).toFixed(2)} |

## Results by Question

| Question | 1-shot | Agent+Sum | Agent+Raw | Sum Searches | Raw Searches |
|----------|--------|-----------|-----------|--------------|--------------|
${results.map((r) => `| ${r.question.slug} | ${r.judgments.oneShotVsSummary.exaScore} | ${r.judgments.oneShotVsSummary.context7Score} | ${r.judgments.oneShotVsRaw.context7Score} | ${r.agentSummary.searchAttempts} | ${r.agentRaw.searchAttempts} |`).join('\n')}
`

	await writeFile(join(outputDir, '_summary.md'), summary)
}

for (const { label, model } of MATRIX) {
	describe(`Agentic Doc Research Eval [${label}]`, () => {
		const labelOutputDir = join(OUTPUT_DIR, label)

		test.skipIf(!EXA_API_KEY || (!ANTHROPIC_API_KEY && !OPENAI_API_KEY))('runs full comparison suite', async () => {
			await mkdir(labelOutputDir, { recursive: true })

			const results: ComparisonResult[] = []

			// Run sequentially to avoid rate limits
			for (const question of EVAL_QUESTIONS) {
				try {
					const result = await runComparison(question, model)
					results.push(result)
					await writeComparisonResult(result, labelOutputDir)
				} catch (error) {
					console.error(`[${question.slug}] Failed:`, error)
				}
			}

			expect(results.length).toBeGreaterThan(0)

			await writeAggregateSummary(results, labelOutputDir)

			console.log(`\n[${label}] Wrote ${results.length} comparison results to ${labelOutputDir}`)
		})

		test.skipIf(!EXA_API_KEY || (!ANTHROPIC_API_KEY && !OPENAI_API_KEY))('single question comparison', async () => {
			const question = EVAL_QUESTIONS[0]!
			const result = await runComparison(question, model)

			expect(result.oneShot.answer.answer.length).toBeGreaterThan(0)
			expect(result.agentSummary.answer.answer.length).toBeGreaterThan(0)
			expect(result.agentRaw.answer.answer.length).toBeGreaterThan(0)
			expect(result.agentSummary.searchAttempts).toBeGreaterThanOrEqual(1)
			expect(result.agentRaw.searchAttempts).toBeGreaterThanOrEqual(1)
		})
	})
}
