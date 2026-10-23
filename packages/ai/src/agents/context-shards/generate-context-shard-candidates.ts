import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

/** Compact citation tag assigned to each packed message while the prompt is built. */
export type ContextShardMessageId = `m${number}`

export type ContextShardInferenceInput = {
	excludedReleasedShards: string[]
	excludedDismissedShards: string[]
	sessions: Array<{
		sessionTag: string
		taskTag: string | null
		messages: Array<{
			messageId: ContextShardMessageId
			role: 'user' | 'assistant'
			content: string
		}>
	}>
}

export type ContextShardInferenceOutput = {
	candidates: Array<{
		shard: string
		reasoning: string
		examples: Array<{
			messageId: ContextShardMessageId
			citation: string
		}> // max 5
	}>
}

/**
 * The injectable inference boundary: the admin generation procedure receives a
 * function with this signature and never constructs a model itself.
 */
export type GenerateContextShardCandidates = (input: ContextShardInferenceInput) => Promise<ContextShardInferenceOutput>

const MESSAGE_ID_PATTERN = /^m[1-9]\d*$/

const MessageIdSchema = z
	.string()
	.regex(MESSAGE_ID_PATTERN, 'message id must be a compact citation tag like m1, m2, m3')

const ContextShardInferenceInputSchema = z.object({
	excludedReleasedShards: z.array(z.string()),
	excludedDismissedShards: z.array(z.string()),
	sessions: z.array(
		z.object({
			sessionTag: z.string().min(1),
			taskTag: z.string().min(1).nullable(),
			messages: z.array(
				z.object({
					messageId: MessageIdSchema,
					role: z.enum(['user', 'assistant']),
					content: z.string(),
				}),
			),
		}),
	),
})

const ContextShardCandidateSchema = z.object({
	shard: z.string().min(1).describe('One short, reusable steering instruction for a coding agent'),
	reasoning: z.string().min(1).describe('Why the conversation evidence supports this shard'),
	examples: z
		.array(
			z.object({
				messageId: MessageIdSchema.describe(
					'The exact message id cited from the conversation evidence, e.g. m3',
				),
				citation: z
					.string()
					.min(1)
					.describe('A short excerpt or concise identification of only the relevant source passage'),
			}),
		)
		.min(1)
		.max(5)
		.describe('Up to 5 supporting citations'),
})

const ContextShardInferenceOutputSchema = z.object({
	candidates: z.array(ContextShardCandidateSchema),
})

export class ContextShardInferenceError extends Error {
	override name = 'ContextShardInferenceError'
}

function escapeXmlText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeXmlAttribute(value: string): string {
	return escapeXmlText(value).replaceAll('"', '&quot;')
}

function renderShardExclusionSection(tagName: string, shards: string[]): string {
	if (shards.length === 0) return `<${tagName}>\n</${tagName}>`
	const items = shards.map((shard) => `  <shard>${escapeXmlText(shard)}</shard>`).join('\n')
	return `<${tagName}>\n${items}\n</${tagName}>`
}

function renderConversationEvidence(sessions: ContextShardInferenceInput['sessions']): string {
	const rendered = sessions
		.map((session) => {
			const taskAttribute = session.taskTag === null ? '' : ` task_id="${escapeXmlAttribute(session.taskTag)}"`
			const messages = session.messages
				.map(
					(message) =>
						`    <message id="${message.messageId}" role="${message.role}">${escapeXmlText(message.content)}</message>`,
				)
				.join('\n')
			return `  <session id="${escapeXmlAttribute(session.sessionTag)}"${taskAttribute}>\n${messages}\n  </session>`
		})
		.join('\n')
	return `<conversation_evidence>\n${rendered}\n</conversation_evidence>`
}

const INSTRUCTIONS = `You are reviewing recent coding-agent conversations from one engineering organization.

Propose "context shards": short, reusable steering instructions that the team keeps repeating to their coding agents. A good shard captures a durable team preference, convention, or lesson that should apply to future agent sessions. Do not summarize individual sessions and do not restate one-off task details.

Rules:
- Only propose a shard when the conversation evidence shows recurring or clearly reusable steering, ideally repeated across sessions or users.
- Write each shard as one standing imperative instruction to a coding agent, at most two sentences.
- Do NOT propose a shard whose meaning is already covered by any excluded shard below, even when the wording differs. Semantic overlap counts as coverage. Released and dismissed exclusions have the same strength.
- For each candidate, give a short reasoning that explains the recurring pattern in the evidence.
- Cite 1 to 5 supporting messages per candidate. Each citation must use the exact message id from the conversation evidence (for example "m3") and include a short excerpt or concise identification of only the passage relevant to the shard. Never reproduce a full message.
- Prefer evidence drawn from more than one session or user when it exists.
- If the evidence contains no recurring, reusable steering beyond the exclusions, return an empty candidates list.`

export function renderContextShardInferencePrompt(input: ContextShardInferenceInput): string {
	return [
		INSTRUCTIONS,
		renderShardExclusionSection('excluded_released_shards', input.excludedReleasedShards),
		renderShardExclusionSection('excluded_dismissed_shards', input.excludedDismissedShards),
		renderConversationEvidence(input.sessions),
	].join('\n\n')
}

/**
 * Generate context shard candidates from already-tagged conversation evidence.
 *
 * Prototype inference: one direct Anthropic Haiku call, no reliable-model
 * fallback and no empty-output fallback. The whole structured output is
 * validated; any missing or malformed output rejects the call.
 */
export async function generateContextShardCandidates(
	input: ContextShardInferenceInput,
	{ model = anthropic('claude-haiku-4-5') }: { model?: LanguageModelV3 } = {},
): Promise<ContextShardInferenceOutput> {
	const parsedInput = ContextShardInferenceInputSchema.safeParse(input)
	if (!parsedInput.success) {
		throw new ContextShardInferenceError(
			`invalid context shard inference input: ${z.prettifyError(parsedInput.error)}`,
		)
	}

	const prompt = renderContextShardInferencePrompt(input)

	const { output } = await generateText({
		model,
		maxRetries: 0,
		prompt,
		output: Output.object({
			schema: ContextShardInferenceOutputSchema,
		}),
	})

	if (output === null || output === undefined) {
		throw new ContextShardInferenceError('context shard inference returned no structured output')
	}

	const parsedOutput = ContextShardInferenceOutputSchema.safeParse(output)
	if (!parsedOutput.success) {
		throw new ContextShardInferenceError(
			`context shard inference returned malformed structured output: ${z.prettifyError(parsedOutput.error)}`,
		)
	}

	const knownMessageIds = new Set(input.sessions.flatMap((session) => session.messages.map((m) => m.messageId)))
	for (const candidate of parsedOutput.data.candidates) {
		for (const example of candidate.examples) {
			if (!knownMessageIds.has(example.messageId as ContextShardMessageId)) {
				throw new ContextShardInferenceError(
					`context shard inference cited unknown message tag "${example.messageId}"`,
				)
			}
		}
	}

	return parsedOutput.data as ContextShardInferenceOutput
}
