import { assert, describe, it } from '@effect/vitest'
import { AnthropicClient, AnthropicLanguageModel } from '@humanlayer/effect-ai-anthropic'
import { OpenAiClient, OpenAiLanguageModel } from '@humanlayer/effect-ai-openai'
import { Effect, Layer, Predicate, Redacted, Schema } from 'effect'
import { LanguageModel, Prompt } from 'effect/ai'
import { HttpClient, type HttpClientError, HttpClientResponse } from 'effect/http'

const toolPrompt = Prompt.fromMessages([
	Prompt.assistantMessage({
		content: [
			Prompt.toolCallPart({
				id: 'call_text',
				name: 'text_tool',
				params: {},
				providerExecuted: false,
			}),
			Prompt.toolCallPart({
				id: 'call_image',
				name: 'image_tool',
				params: {},
				providerExecuted: false,
			}),
			Prompt.toolCallPart({
				id: 'call_object',
				name: 'object_tool',
				params: {},
				providerExecuted: false,
			}),
		],
	}),
	Prompt.toolMessage({
		content: [
			Prompt.toolResultPart({
				id: 'call_text',
				name: 'text_tool',
				result: 'PLAIN_TEXT_SENTINEL\n',
				isFailure: false,
				providerExecuted: false,
			}),
			Prompt.toolResultPart({
				id: 'call_image',
				name: 'image_tool',
				result: [
					Prompt.textPart({ text: 'IMAGE_TEXT_SENTINEL' }),
					Prompt.filePart({ mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) }),
				],
				isFailure: false,
				providerExecuted: false,
			}),
			Prompt.toolResultPart({
				id: 'call_object',
				name: 'object_tool',
				result: { answer: 42 },
				isFailure: false,
				providerExecuted: false,
			}),
		],
	}),
])

const capturingHttpClient = (responseBody: unknown) => {
	let requestBody: unknown = null
	const preprocess: HttpClient.HttpClient.Preprocess<HttpClientError.HttpClientError, never> = Effect.succeed
	const client = HttpClient.makeWith(
		Effect.fnUntraced(function* (requestEffect) {
			const request = yield* requestEffect
			if (!Predicate.isTagged(request.body, 'Uint8Array')) return yield* Effect.die('expected request bytes')
			requestBody = JSON.parse(new TextDecoder().decode(request.body.body))
			return HttpClientResponse.fromWeb(
				request,
				new Response(JSON.stringify(responseBody), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
		}),
		preprocess,
	)
	return { client, requestBody: () => requestBody }
}

const RequestBlocks = Schema.Array(Schema.Record(Schema.String, Schema.Unknown))

describe('Riptide daemon Effect provider forks', () => {
	it.effect('encodes OpenAI text and image tool results natively with object fallback', () =>
		Effect.gen(function* () {
			const captured = capturingHttpClient({
				id: 'resp_test',
				object: 'response',
				created_at: 0,
				model: 'gpt-test',
				status: 'completed',
				output: [],
				metadata: null,
				temperature: null,
				top_p: null,
				tools: [],
				tool_choice: 'auto',
				error: null,
				incomplete_details: null,
				instructions: null,
				parallel_tool_calls: true,
			})
			const clientLayer = OpenAiClient.layer({ apiKey: Redacted.make('sk-test') }).pipe(
				Layer.provide(Layer.succeed(HttpClient.HttpClient, captured.client)),
			)
			const modelLayer = OpenAiLanguageModel.model('gpt-test').pipe(Layer.provide(clientLayer))

			yield* LanguageModel.generateText({ prompt: toolPrompt }).pipe(Effect.provide(modelLayer))

			const body = yield* Schema.decodeUnknownEffect(Schema.Struct({ input: RequestBlocks }))(
				captured.requestBody(),
			)
			const outputFor = (callId: string) =>
				body.input.find((item) => item['type'] === 'function_call_output' && item['call_id'] === callId)?.[
					'output'
				]
			assert.strictEqual(outputFor('call_text'), 'PLAIN_TEXT_SENTINEL\n')
			assert.strictEqual(outputFor('call_object'), '{"answer":42}')
			assert.deepStrictEqual(outputFor('call_image'), [
				{ type: 'input_text', text: 'IMAGE_TEXT_SENTINEL' },
				{
					type: 'input_image',
					image_url: 'data:image/png;base64,iVBORw==',
					detail: 'auto',
				},
			])
		}),
	)

	it.effect('encodes Anthropic text and image tool results natively with object fallback', () =>
		Effect.gen(function* () {
			const captured = capturingHttpClient({
				id: 'msg_test',
				type: 'message',
				role: 'assistant',
				model: 'claude-test',
				content: [{ type: 'text', text: 'ok' }],
				stop_reason: 'end_turn',
				stop_sequence: null,
				usage: {
					cache_creation: null,
					cache_creation_input_tokens: null,
					cache_read_input_tokens: null,
					inference_geo: null,
					input_tokens: 1,
					output_tokens: 1,
					service_tier: null,
				},
			})
			const clientLayer = AnthropicClient.layer({ apiKey: Redacted.make('sk-test') }).pipe(
				Layer.provide(Layer.succeed(HttpClient.HttpClient, captured.client)),
			)
			const modelLayer = AnthropicLanguageModel.model('claude-test').pipe(Layer.provide(clientLayer))

			yield* LanguageModel.generateText({ prompt: toolPrompt }).pipe(Effect.provide(modelLayer))

			const body = yield* Schema.decodeUnknownEffect(
				Schema.Struct({
					messages: Schema.Array(Schema.Struct({ role: Schema.String, content: RequestBlocks })),
				}),
			)(captured.requestBody())
			const blocks = body.messages.flatMap((message) => message.content)
			const contentFor = (callId: string) =>
				blocks.find((block) => block['type'] === 'tool_result' && block['tool_use_id'] === callId)?.['content']
			assert.strictEqual(contentFor('call_text'), 'PLAIN_TEXT_SENTINEL\n')
			assert.strictEqual(contentFor('call_object'), '{"answer":42}')
			assert.deepStrictEqual(contentFor('call_image'), [
				{ type: 'text', text: 'IMAGE_TEXT_SENTINEL' },
				{
					type: 'image',
					source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' },
				},
			])
		}),
	)
})
