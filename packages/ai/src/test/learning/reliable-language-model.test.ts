import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import { Schedule } from 'effect'
import { describe, expect, test, vi } from 'vitest'
import z from 'zod/v4'

import { createReliableLanguageModel } from '../../reliable-language-model'

function startBlackhole(errorBody: object, statusCode: number) {
	const server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response(JSON.stringify(errorBody), {
				status: statusCode,
				headers: { 'Content-Type': 'application/json' },
			}),
	})
	return { port: server.port, stop: () => server.stop(true) }
}

type ModelAlias = 'haiku' | 'sonnet'

function makeReliableModel({
	anthropicBaseURL,
	openaiBaseURL,
	alias = 'haiku',
	onAnyError = () => {},
	onFailure = () => {},
}: {
	anthropicBaseURL?: string
	openaiBaseURL?: string
	alias?: ModelAlias
	onAnyError?: (error: unknown) => void
	onFailure?: (error: unknown) => void
} = {}) {
	const anthropicProvider = createAnthropic({ baseURL: anthropicBaseURL })
	const openaiProvider = createOpenAI({ baseURL: openaiBaseURL })
	const primaryId = alias === 'haiku' ? 'claude-haiku-4-5' : 'claude-sonnet-5'
	const fallbackId = alias === 'haiku' ? 'gpt-5-mini' : 'gpt-5'
	return createReliableLanguageModel({
		primary: anthropicProvider(primaryId),
		secondary: openaiProvider(fallbackId),
		retrySchedule: Schedule.recurs(1),
		onAnyError,
		onFailure,
	})
}

const Schema = z.object({ title: z.string() })

describe.skipIf(Boolean(process.env.CI) || !process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY)(
	'reliable language model end-to-end',
	() => {
		test('anthropic blackhole -> openai answers', async () => {
			const onAnyError = vi.fn(() => {})
			const onFailure = vi.fn(() => {})
			const blackhole = startBlackhole(
				{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
				529,
			)
			try {
				const { output } = await generateText({
					model: makeReliableModel({
						anthropicBaseURL: `http://localhost:${blackhole.port}`,
						onAnyError,
						onFailure,
					}),
					maxRetries: 0,
					prompt: 'Generate a 3-word title for "refactor login flow"',
					output: Output.object({ schema: Schema }),
					providerOptions: { openai: { strictJsonSchema: false } },
				})
				expect(output?.title?.length).toBeGreaterThan(0)
				expect(onAnyError).toHaveBeenCalledTimes(2)
				expect(onFailure).toHaveBeenCalledTimes(0)
			} finally {
				blackhole.stop()
			}
		}, 60_000)

		test('openai blackhole -> anthropic answers', async () => {
			const onAnyError = vi.fn(() => {})
			const onFailure = vi.fn(() => {})
			const blackhole = startBlackhole({ error: { type: 'rate_limit_error' } }, 429)
			try {
				const { output } = await generateText({
					model: makeReliableModel({
						openaiBaseURL: `http://localhost:${blackhole.port}`,
						onAnyError,
						onFailure,
					}),
					maxRetries: 0,
					prompt: 'Generate a 3-word title for "refactor login flow"',
					output: Output.object({ schema: Schema }),
				})
				expect(output?.title?.length).toBeGreaterThan(0)
				expect(onAnyError).toHaveBeenCalledTimes(0)
				expect(onFailure).toHaveBeenCalledTimes(0)
			} finally {
				blackhole.stop()
			}
		}, 60_000)

		test('both blackhole -> onFailure receives final fallback error', async () => {
			const onAnyError = vi.fn(() => {})
			const onFailure = vi.fn(() => {})
			const anth = startBlackhole(
				{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
				529,
			)
			const oai = startBlackhole({ error: { type: 'rate_limit_error' } }, 429)
			try {
				await expect(
					generateText({
						model: makeReliableModel({
							anthropicBaseURL: `http://localhost:${anth.port}`,
							openaiBaseURL: `http://localhost:${oai.port}`,
							onAnyError,
							onFailure,
						}),
						maxRetries: 0,
						prompt: 'Generate a 3-word title',
						output: Output.object({ schema: Schema }),
						providerOptions: { openai: { strictJsonSchema: false } },
					}),
				).rejects.toThrow()
				expect(onAnyError).toHaveBeenCalledTimes(4)
				expect(onFailure).toHaveBeenCalledTimes(1)
			} finally {
				anth.stop()
				oai.stop()
			}
		}, 60_000)
	},
)
