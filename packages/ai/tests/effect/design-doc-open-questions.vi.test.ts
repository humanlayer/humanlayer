import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	checkIfDesignDocHasOpenQuestionsWithService,
	DesignDocQuestionCounter,
	DesignQuestionInferenceError,
} from '../../src/agents/design-doc-open-questions'

describe('checkIfDesignDocHasOpenQuestions', () => {
	it('passes doc content to the counter service and returns its counts', async () => {
		const docContent = 'sentinel-design-doc'
		const expected = { numOpenQuestions: 2, numResolvedQuestions: 1 }
		let receivedDocContent: string | undefined

		const result = await Effect.runPromise(
			checkIfDesignDocHasOpenQuestionsWithService(docContent).pipe(
				Effect.provide(
					Layer.succeed(DesignDocQuestionCounter, {
						count: async (value) => {
							receivedDocContent = value
							return expected
						},
					}),
				),
			),
		)

		expect(receivedDocContent).toBe(docContent)
		expect(result).toEqual(expected)
	})

	it('wraps failures in DesignQuestionInferenceError', async () => {
		const result = await Effect.runPromise(
			checkIfDesignDocHasOpenQuestionsWithService('design doc').pipe(
				Effect.provide(
					Layer.succeed(DesignDocQuestionCounter, {
						count: async () => {
							throw new Error('model unavailable')
						},
					}),
				),
				Effect.flip,
			),
		)

		expect(result).toBeInstanceOf(DesignQuestionInferenceError)
		expect(result.message).toBe('Failed to count design questions')
	})
})
