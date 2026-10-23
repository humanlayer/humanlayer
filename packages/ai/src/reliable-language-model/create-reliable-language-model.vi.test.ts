import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult } from '@ai-sdk/provider'
import { Schedule } from 'effect'
import { describe, expect, test, vi } from 'vitest'

import { createReliableLanguageModel } from './create-reliable-language-model'

const generateResult = (text: string): LanguageModelV3GenerateResult => ({
	content: [{ type: 'text', text }],
	finishReason: { unified: 'stop', raw: 'stop' },
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
	warnings: [],
})

const streamResult = (text: string) => ({
	stream: new ReadableStream({
		start(controller) {
			controller.enqueue({ type: 'text-delta', id: '0', delta: text })
			controller.close()
		},
	}),
	warnings: [],
})

function makeModel(overrides: Partial<LanguageModelV3> = {}): LanguageModelV3 {
	return {
		specificationVersion: 'v3',
		provider: 'test',
		modelId: 'test-model',
		supportedUrls: {},
		doGenerate: vi.fn(async () => generateResult('primary')),
		doStream: vi.fn(async () => streamResult('primary')),
		...overrides,
	}
}

describe('createReliableLanguageModel', () => {
	test('wrapGenerate returns the primary result when primary succeeds', async () => {
		const primary = makeModel()
		const secondary = makeModel({ doGenerate: vi.fn(async () => generateResult('secondary')) })
		const model = createReliableLanguageModel({ primary, secondary })

		const result = await model.doGenerate({} as LanguageModelV3CallOptions)

		expect(result).toEqual(generateResult('primary'))
		expect(primary.doGenerate).toHaveBeenCalledTimes(1)
		expect(secondary.doGenerate).not.toHaveBeenCalled()
	})

	test('wrapGenerate calls secondary with params after primary failure', async () => {
		const params = { temperature: 0 } as LanguageModelV3CallOptions
		const error = new Error('primary failed')
		const onAnyError = vi.fn()
		const primary = makeModel({ doGenerate: vi.fn(async () => Promise.reject(error)) })
		const secondary = makeModel({ doGenerate: vi.fn(async () => generateResult('secondary')) })
		const model = createReliableLanguageModel({ primary, secondary, retrySchedule: Schedule.recurs(0), onAnyError })

		const result = await model.doGenerate(params)

		expect(result).toEqual(generateResult('secondary'))
		expect(onAnyError).toHaveBeenCalledWith(error)
		expect(secondary.doGenerate).toHaveBeenCalledWith(params)
	})

	test('wrapStream mirrors generate fallback behavior', async () => {
		const params = { temperature: 0 } as LanguageModelV3CallOptions
		const error = new Error('primary stream failed')
		const onAnyError = vi.fn()
		const primary = makeModel({ doStream: vi.fn(async () => Promise.reject(error)) })
		const secondary = makeModel({ doStream: vi.fn(async () => streamResult('secondary')) })
		const model = createReliableLanguageModel({ primary, secondary, retrySchedule: Schedule.recurs(0), onAnyError })

		const result = await model.doStream(params)

		expect(result.stream).toBeInstanceOf(ReadableStream)
		expect(onAnyError).toHaveBeenCalledWith(error)
		expect(secondary.doStream).toHaveBeenCalledWith(params)
	})

	test('rejects with original error and calls onFailure after both models fail', async () => {
		const primaryError = new Error('primary failed')
		const secondaryError = new Error('secondary failed')
		const onFailure = vi.fn()
		const primary = makeModel({ doGenerate: vi.fn(async () => Promise.reject(primaryError)) })
		const secondary = makeModel({ doGenerate: vi.fn(async () => Promise.reject(secondaryError)) })
		const model = createReliableLanguageModel({ primary, secondary, retrySchedule: Schedule.recurs(0), onFailure })

		await expect(model.doGenerate({} as LanguageModelV3CallOptions)).rejects.toBe(secondaryError)
		expect(onFailure).toHaveBeenCalledTimes(1)
		expect(onFailure).toHaveBeenCalledWith(secondaryError)
	})
})
