import { createServer, type Server } from 'node:http'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toUsageEventTokenMap } from './token-usage'

/**
 * Wire-level integration test. A local mock serves the Anthropic Messages
 * API with known token counts. The REAL AgentLayer agent runs against it:
 * real `@ai-sdk/anthropic` adapter, real `TokenUsageAccumulator`. The test
 * then asserts that the daemon conversion reproduces the wire counts
 * exactly. The API/DB persistence layers are covered separately by the
 * container-backed tests.
 *
 * Wire truth (Anthropic convention: input EXCLUDES cache):
 *   call 1 (cold): input 1234, cache_creation 7000, cache_read 0
 *   call 2 (warm): input 1234, cache_creation 500,  cache_read 50000
 * The adapter reports these to AgentLayer as cache-INCLUSIVE totals
 * (8234 and 51734). The stored row must say 1234 again.
 */

let server: Server
let calls = 0
const savedEnv: Record<string, string | undefined> = {}

const wireUsage = (call: number) =>
	call === 1
		? { input_tokens: 1234, cache_creation_input_tokens: 7000, cache_read_input_tokens: 0, output_tokens: 60 }
		: { input_tokens: 1234, cache_creation_input_tokens: 500, cache_read_input_tokens: 50000, output_tokens: 60 }

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.method !== 'POST' || !req.url?.endsWith('/messages')) {
			res.writeHead(404).end()
			return
		}
		calls += 1
		const u = wireUsage(calls)
		res.writeHead(200, { 'content-type': 'text/event-stream' })
		const ev = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
		ev('message_start', {
			type: 'message_start',
			message: {
				id: `msg_${calls}`,
				type: 'message',
				role: 'assistant',
				model: 'claude-mock',
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...u, output_tokens: 1 },
			},
		})
		ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
		ev('content_block_delta', {
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'text_delta', text: `mock ${calls}` },
		})
		ev('content_block_stop', { type: 'content_block_stop', index: 0 })
		ev('message_delta', {
			type: 'message_delta',
			delta: { stop_reason: 'end_turn', stop_sequence: null },
			usage: { output_tokens: u.output_tokens },
		})
		ev('message_stop', { type: 'message_stop' })
		res.end()
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = (server.address() as { port: number }).port
	for (const [k, v] of Object.entries({
		ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/v1`,
		ANTHROPIC_API_KEY: 'mock-key-wire-test',
	})) {
		savedEnv[k] = process.env[k]
		process.env[k] = v
	}
})

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()))
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k]
		else process.env[k] = v
	}
})

describe('wire -> adapter -> accumulator -> daemon conversion', () => {
	it('stores the exact wire counts for a cold and a warm cache run', async () => {
		const { Agent, startState, userMessage } = await import('@humanlayer/agentlayer-core')
		const { resolveModel } = await import('@humanlayer/codelayer')
		const model = await resolveModel('anthropic', 'claude-mock')

		const runOnce = async () => {
			const agent = new Agent({ model, tools: {} })
			const run = agent.run({ state: startState([userMessage('hi')]), stream: true })
			// Drain the event stream; the accumulator fills as the stream runs.
			for await (const _event of run) {
				// events are not asserted here; only the usage matters
			}
			return (await run.result).tokenUsage.byModel
		}

		// Cold run: the adapter reports an inclusive total of 8234.
		const cold = await runOnce()
		// One request per run. A silent SDK retry would shift the fixture
		// schedule and fail the warm assertions confusingly; fail here instead.
		expect(calls).toBe(1)
		const coldUsage = Object.values(cold)[0]!
		expect(coldUsage.inputTokens).toBe(1234 + 7000)
		expect(toUsageEventTokenMap(coldUsage)).toEqual({
			input_tokens: 1234,
			output_tokens: 60,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 7000,
		})

		// Warm run: inclusive total 51734; the stored row must say 1234 again.
		const warm = await runOnce()
		expect(calls).toBe(2)
		const warmUsage = Object.values(warm)[0]!
		expect(toUsageEventTokenMap(warmUsage)).toEqual({
			input_tokens: 1234,
			output_tokens: 60,
			cache_read_input_tokens: 50000,
			cache_creation_input_tokens: 500,
		})
	})
})
