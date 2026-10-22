/**
 * Eval: Doc Research Tool Comparison (Exa vs Context7)
 *
 * Runs full evaluation suite comparing both tools on curated questions.
 * Uses LLM-as-judge (Opus) to score raw outputs and summarized answers.
 *
 * Run with: bun --cwd packages/ai eval:doc-research
 */

import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { buildMatrix } from '../_lib/matrix'
import { EVAL_QUESTIONS, runAllEvaluations, runEvaluation } from './index'
import { writeAggregateResults, writeEvalResult } from './writer'

// 20 minutes for full suite (16 questions with concurrency=3)

const EXA_API_KEY = process.env.EXA_API_KEY
const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const OUTPUT_DIR = join(import.meta.dir, '../../eval-results')

const MATRIX = buildMatrix({
	anthropic: { label: 'anthropic-sonnet', modelId: 'claude-sonnet-4-6' },
	openai: { label: 'openai-gpt-5', modelId: 'gpt-5' },
})

for (const { label, model } of MATRIX) {
	describe(`Doc Research Eval [${label}]`, () => {
		test.skipIf(!EXA_API_KEY || !CONTEXT7_API_KEY || (!ANTHROPIC_API_KEY && !OPENAI_API_KEY))(
			'runs full evaluation suite and writes results',
			async () => {
				const labelOutputDir = join(OUTPUT_DIR, label)

				// Run evaluations
				const results = await runAllEvaluations(EVAL_QUESTIONS, 3, { model })

				expect(results.length).toBeGreaterThan(0)

				// Write individual results
				for (const result of results) {
					await writeEvalResult(result, labelOutputDir)
				}

				// Write aggregate summary
				await writeAggregateResults(results, labelOutputDir)

				console.log(`\n[${label}] Wrote ${results.length} evaluation results to ${labelOutputDir}`)

				// Basic assertions on aggregate results
				const exaWins = results.filter((r) => r.rawJudgment.winner === 'exa').length
				const context7Wins = results.filter((r) => r.rawJudgment.winner === 'context7').length
				const ties = results.filter((r) => r.rawJudgment.winner === 'tie').length

				console.log(`\n[${label}] Raw judgment results: Exa ${exaWins}, Context7 ${context7Wins}, Ties ${ties}`)
			},
		)

		test.skipIf(!EXA_API_KEY || !CONTEXT7_API_KEY || (!ANTHROPIC_API_KEY && !OPENAI_API_KEY))(
			'single question evaluation works',
			async () => {
				// Test with first question only for faster iteration
				const question = EVAL_QUESTIONS[0]!
				const result = await runEvaluation(question, { model })

				expect(result.exaResult.rawResponse.length).toBeGreaterThan(0)
				expect(result.context7Result.rawResponse.length).toBeGreaterThan(0)
				expect(result.exaSummary.answer.length).toBeGreaterThan(0)
				expect(result.context7Summary.answer.length).toBeGreaterThan(0)
				expect(['exa', 'context7', 'tie']).toContain(result.rawJudgment.winner)
				expect(result.rawJudgment.exaScore).toBeGreaterThanOrEqual(1)
				expect(result.rawJudgment.exaScore).toBeLessThanOrEqual(4)
			},
		)
	})
}
