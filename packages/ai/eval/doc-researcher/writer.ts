import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { EvalResult, JudgmentResult } from './types'

function scoreLabel(score: number): string {
	switch (score) {
		case 1:
			return 'Not helpful'
		case 2:
			return 'Somewhat correct'
		case 3:
			return 'Mostly correct'
		case 4:
			return 'Exactly correct'
		default:
			return `${score}/4`
	}
}

function formatJudgment(judgment: JudgmentResult, mode: string): string {
	return `### ${mode}

**Winner**: ${judgment.winner.toUpperCase()}

**Scores** (1-4 scale):
- Exa: ${judgment.exaScore}/4 (${scoreLabel(judgment.exaScore)})
- Context7: ${judgment.context7Score}/4 (${scoreLabel(judgment.context7Score)})

**Reasoning**:
${judgment.reasoning}
`
}

export async function writeEvalResult(result: EvalResult, outputDir: string): Promise<void> {
	const questionDir = join(outputDir, result.question.slug)
	await mkdir(questionDir, { recursive: true })

	// Write question.md
	await writeFile(
		join(questionDir, 'question.md'),
		`# ${result.question.question}

**Category**: ${result.question.category}

## Reference Answer

${result.question.answer}
`,
	)

	// Write exa-response.md
	await writeFile(
		join(questionDir, 'exa-response.md'),
		`# Exa Response

**Request ID**: ${result.exaResult.requestId}
**Results Count**: ${result.exaResult.resultsCount}
**Output Tokens**: ${result.exaResult.outputTokens}
**Search Time**: ${result.exaResult.searchTimeMs}ms

## Raw Response

${result.exaResult.rawResponse}

---

## Sonnet Summary

**Answer**: ${result.exaSummary.answer}

**Key Points**:
${result.exaSummary.keyPoints.map((p) => `- ${p}`).join('\n')}

**Code Snippets**:
${result.exaSummary.codeSnippets || 'None'}

**Confidence**: ${result.exaSummary.confidence}
`,
	)

	// Write context7-response.md
	await writeFile(
		join(questionDir, 'context7-response.md'),
		`# Context7 Response

**Selected Library**: ${result.context7Result.selectedLibrary.title} (${result.context7Result.selectedLibrary.id})
**Libraries Considered**: ${result.context7Result.librariesConsidered.length}

## Raw Response

${result.context7Result.rawResponse}

---

## Sonnet Summary

**Answer**: ${result.context7Summary.answer}

**Key Points**:
${result.context7Summary.keyPoints.map((p) => `- ${p}`).join('\n')}

**Code Snippets**:
${result.context7Summary.codeSnippets || 'None'}

**Confidence**: ${result.context7Summary.confidence}
`,
	)

	// Write judgment.md
	await writeFile(
		join(questionDir, 'judgment.md'),
		`# Judgment

${formatJudgment(result.rawJudgment, 'Raw Output Comparison')}

---

${formatJudgment(result.summaryJudgment, 'Summarized Answer Comparison')}
`,
	)
}

export async function writeAggregateResults(results: EvalResult[], outputDir: string): Promise<void> {
	const rawWins = { exa: 0, context7: 0, tie: 0 }
	const summaryWins = { exa: 0, context7: 0, tie: 0 }
	let totalExaRawScore = 0
	let totalContext7RawScore = 0
	let totalExaSummaryScore = 0
	let totalContext7SummaryScore = 0

	for (const result of results) {
		rawWins[result.rawJudgment.winner]++
		summaryWins[result.summaryJudgment.winner]++
		totalExaRawScore += result.rawJudgment.exaScore
		totalContext7RawScore += result.rawJudgment.context7Score
		totalExaSummaryScore += result.summaryJudgment.exaScore
		totalContext7SummaryScore += result.summaryJudgment.context7Score
	}

	const count = results.length

	const summary = `# Evaluation Summary

**Total Questions**: ${count}
**Date**: ${new Date().toISOString()}

## Scoring Scale

| Score | Meaning |
|-------|---------|
| 1 | Not helpful - answer is wrong or irrelevant |
| 2 | Somewhat correct - has some right info but missing key details |
| 3 | Mostly correct - good answer with minor omissions |
| 4 | Exactly correct - contains all necessary information |

## Raw Output Mode

| Winner | Count | Percentage |
|--------|-------|------------|
| Exa | ${rawWins.exa} | ${((rawWins.exa / count) * 100).toFixed(1)}% |
| Context7 | ${rawWins.context7} | ${((rawWins.context7 / count) * 100).toFixed(1)}% |
| Tie | ${rawWins.tie} | ${((rawWins.tie / count) * 100).toFixed(1)}% |

**Average Scores**: Exa ${(totalExaRawScore / count).toFixed(2)}/4, Context7 ${(totalContext7RawScore / count).toFixed(2)}/4

## Summarized Answer Mode

| Winner | Count | Percentage |
|--------|-------|------------|
| Exa | ${summaryWins.exa} | ${((summaryWins.exa / count) * 100).toFixed(1)}% |
| Context7 | ${summaryWins.context7} | ${((summaryWins.context7 / count) * 100).toFixed(1)}% |
| Tie | ${summaryWins.tie} | ${((summaryWins.tie / count) * 100).toFixed(1)}% |

**Average Scores**: Exa ${(totalExaSummaryScore / count).toFixed(2)}/4, Context7 ${(totalContext7SummaryScore / count).toFixed(2)}/4

## Results by Question

| Question | Category | Raw Winner | Raw Exa | Raw C7 | Summary Winner | Sum Exa | Sum C7 |
|----------|----------|------------|---------|--------|----------------|---------|--------|
${results.map((r) => `| ${r.question.slug} | ${r.question.category} | ${r.rawJudgment.winner} | ${r.rawJudgment.exaScore} | ${r.rawJudgment.context7Score} | ${r.summaryJudgment.winner} | ${r.summaryJudgment.exaScore} | ${r.summaryJudgment.context7Score} |`).join('\n')}
`

	await writeFile(join(outputDir, '_summary.md'), summary)
}
