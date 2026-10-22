import { anthropic } from '@ai-sdk/anthropic'
import { type LearnQuestionSet, LearnQuestionSetSchema } from '@humanlayer/db/zodschemas/learn-questions'
import { generateText, Output } from 'ai'

const GENERATION_PROMPT = `You are a codebase quiz generator. Given a research document about a software codebase, generate 3-5 multiple choice quiz questions that help someone deeply understand how the system works.

## Abstraction level

Target MID-LEVEL questions about mechanisms, behaviors, and design trade-offs. The goal is to teach the reader how and why the system works the way it does.

GOOD question patterns (mid-level — mechanisms and behavior):
- "How does X handle Y?" — tests understanding of a mechanism
- "What happens when X occurs?" — tests understanding of system behavior
- "Why does the system use X instead of Y?" — tests understanding of design trade-offs
- "What problem does X solve?" — tests understanding of purpose behind a pattern

BAD question patterns (too low-level — trivia recall):
- "Which file contains X?" — just tests whether you memorized a path
- "What is the exact config value for X?" — just tests whether you memorized a number
- "What is the function name that does X?" — just tests whether you memorized a name

BAD question patterns (too high-level — obvious from context):
- "What technology does the app use for X?" — answerable from a one-line summary
- "What is the purpose of this system?" — too vague to be useful

## Answer options

Each option label is a markdown snippet. Options can be plain text, or include fenced code blocks (\`\`\`), inline code, or mermaid diagrams — whatever best communicates the answer.

MANDATORY: At least 1 out of every 3 questions MUST have options containing fenced code blocks (\`\`\`). Even if the research document is mostly prose, it will reference code patterns, function calls, error handling, or configuration — synthesize these into code snippet options. The reader learns far more from seeing and evaluating real code than from reading prose descriptions of code.

When creating code-block options:
- Extract or reconstruct realistic code from the patterns described in the research
- Show 2-3 plausible code approaches where only one is correct
- Include enough context that the reader can reason about correctness

Example of a good option with a code block:
"Fire-and-forget with no re-query:\\n\`\`\`ts\\nrunAsync(db, txResult.id, txResult.content)\\n\`\`\`"

Example of another good option with a code block:
"Re-query inside the async function:\\n\`\`\`ts\\nasync function runAsync(db, id) {\\n  const row = await db.select().from(table).where(eq(id))\\n  // use row.content\\n}\\n\`\`\`"

MANDATORY: If the research describes data flows, request lifecycles, state transitions, or component relationships, at least 1 question MUST have options containing mermaid diagrams (\`\`\`mermaid). Mermaid diagrams are ideal for testing whether someone understands the correct flow or ordering of a process. Keep diagrams compact: max 5 nodes, short labels, use \`graph TD\` or \`sequenceDiagram\`.

Example of a good option with a mermaid diagram:
"Data syncs from DB through proxy to browser:\\n\`\`\`mermaid\\ngraph TD\\n  A[Postgres] --> B[Electric Proxy]\\n  B --> C[TanStack DB]\\n  C --> D[Component]\\n\`\`\`"

Each question should have 2-4 options with exactly one correct answer. Make distractors plausible — they should represent common misconceptions or reasonable-sounding alternatives that get a specific detail wrong.

Write engaging explanations that teach — don't just confirm the answer, explain the reasoning behind why the system works this way.

If hasQuestions is false, provide a reason why (e.g., content is too short or not technical enough).

Research document:
---
{content}
---`

const LearnQuestionSetOutputSchema = LearnQuestionSetSchema.omit({ generatedAt: true })

export async function generateLearnQuestions(content: string): Promise<LearnQuestionSet> {
	const prompt = GENERATION_PROMPT.replace('{content}', content)

	const { output } = await generateText({
		model: anthropic('claude-sonnet-5'),
		prompt,
		output: Output.object({
			schema: LearnQuestionSetOutputSchema,
		}),
	})

	return {
		...output,
		generatedAt: Date.now(),
	} as LearnQuestionSet
}
