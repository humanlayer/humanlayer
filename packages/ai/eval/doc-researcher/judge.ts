import { anthropic } from '@ai-sdk/anthropic'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

import type { JudgmentResult, SummarizedAnswer } from './types'

/**
 * Simplified 1-4 scale:
 * 1 = Not helpful - answer is wrong or irrelevant
 * 2 = Somewhat correct - has some right info but missing key details
 * 3 = Mostly correct - good answer with minor omissions
 * 4 = Exactly correct - contains all necessary information
 */
const SingleScoreSchema = z.object({
	score: z
		.number()
		.describe(
			'Score from 1-4: 1=not helpful (wrong/irrelevant), 2=somewhat correct (missing key details or code), 3=mostly correct (minor omissions), 4=exactly correct (all info present)',
		),
	reasoning: z.string().describe('Brief explanation of the score'),
	hasCodeExamples: z.boolean().describe('Whether the response includes relevant code examples'),
	isCorrect: z.boolean().describe('Whether the core answer is factually correct'),
})

function clampScore(score: number): 1 | 2 | 3 | 4 {
	return Math.max(1, Math.min(4, Math.round(score))) as 1 | 2 | 3 | 4
}

function determineWinner(exaScore: number, context7Score: number): 'exa' | 'context7' | 'tie' {
	if (exaScore > context7Score) return 'exa'
	if (context7Score > exaScore) return 'context7'
	return 'tie'
}

async function scoreResponse(
	question: string,
	referenceAnswer: string,
	response: string,
	sourceName: string,
): Promise<{ score: 1 | 2 | 3 | 4; reasoning: string }> {
	const prompt = `You are an expert judge evaluating a documentation search result for answering a developer question.

Question: ${question}

=== REFERENCE ANSWER (Ground Truth) ===
${referenceAnswer}

=== ${sourceName.toUpperCase()} RESPONSE ===
${response}

Score this response on a 1-4 scale:
1 = Not helpful - answer is wrong, irrelevant, or completely misses the point
2 = Somewhat correct - has some right info but missing key details OR missing code examples for a technical question
3 = Mostly correct - good answer with only minor omissions
4 = Exactly correct - contains all necessary information including code examples

SCORING RULES:
- If the answer is factually WRONG, score 1
- If the answer is correct but MISSING CODE EXAMPLES for a "how do I" question, score max 2
- If the answer is correct with code but missing some details, score 3
- If the answer is correct, has code examples, and covers key points, score 4

DO NOT penalize for:
- Not matching the reference answer exactly (only correctness matters)
- Length differences (more isn't necessarily better)
- Minor formatting differences`

	const { output } = await generateText({
		model: anthropic('claude-opus-4-5-20251101'),
		prompt,
		output: Output.object({ schema: SingleScoreSchema }),
	})

	return {
		score: clampScore(output.score),
		reasoning: output.reasoning,
	}
}

async function scoreSummarizedResponse(
	question: string,
	referenceAnswer: string,
	summary: SummarizedAnswer,
	sourceName: string,
): Promise<{ score: 1 | 2 | 3 | 4; reasoning: string }> {
	const codeSnippetsSection =
		summary.codeSnippets.trim().length > 0
			? `Code Snippets:\n${summary.codeSnippets}`
			: 'Code Snippets: NONE PROVIDED'

	const prompt = `You are an expert judge evaluating a summarized answer to a developer question.

Question: ${question}

=== REFERENCE ANSWER (Ground Truth) ===
${referenceAnswer}

=== ${sourceName.toUpperCase()} SUMMARIZED ANSWER ===
Answer: ${summary.answer}

Key Points:
${summary.keyPoints.map((p) => `- ${p}`).join('\n')}

${codeSnippetsSection}

Confidence: ${summary.confidence}

Score this response on a 1-4 scale:
1 = Not helpful - answer is wrong, irrelevant, or completely misses the point
2 = Somewhat correct - has some right info but missing key details OR missing code examples for a technical question
3 = Mostly correct - good answer with only minor omissions
4 = Exactly correct - contains all necessary information including code examples

SCORING RULES:
- If the answer is factually WRONG, score 1
- If the answer is correct but MISSING CODE EXAMPLES for a "how do I" question, score max 2
- If the answer is correct with code but missing some details, score 3
- If the answer is correct, has code examples, and covers key points, score 4

DO NOT penalize for:
- Not matching the reference answer exactly (only correctness matters)
- Length differences (more isn't necessarily better)
- Minor formatting differences`

	const { output } = await generateText({
		model: anthropic('claude-opus-4-5-20251101'),
		prompt,
		output: Output.object({ schema: SingleScoreSchema }),
	})

	return {
		score: clampScore(output.score),
		reasoning: output.reasoning,
	}
}

export async function judgeRawOutputs(
	question: string,
	referenceAnswer: string,
	exaRaw: string,
	context7Raw: string,
): Promise<JudgmentResult> {
	// Score each response independently in parallel
	const [exaResult, context7Result] = await Promise.all([
		scoreResponse(question, referenceAnswer, exaRaw, 'Exa'),
		scoreResponse(question, referenceAnswer, context7Raw, 'Context7'),
	])

	// Determine winner deterministically
	const winner = determineWinner(exaResult.score, context7Result.score)

	return {
		winner,
		reasoning: `Exa: ${exaResult.reasoning}\n\nContext7: ${context7Result.reasoning}`,
		exaScore: exaResult.score,
		context7Score: context7Result.score,
	}
}

export async function judgeSummarizedAnswers(
	question: string,
	referenceAnswer: string,
	exaSummary: SummarizedAnswer,
	context7Summary: SummarizedAnswer,
): Promise<JudgmentResult> {
	// Score each response independently in parallel
	const [exaResult, context7Result] = await Promise.all([
		scoreSummarizedResponse(question, referenceAnswer, exaSummary, 'Exa'),
		scoreSummarizedResponse(question, referenceAnswer, context7Summary, 'Context7'),
	])

	// Determine winner deterministically
	const winner = determineWinner(exaResult.score, context7Result.score)

	return {
		winner,
		reasoning: `Exa: ${exaResult.reasoning}\n\nContext7: ${context7Result.reasoning}`,
		exaScore: exaResult.score,
		context7Score: context7Result.score,
	}
}
