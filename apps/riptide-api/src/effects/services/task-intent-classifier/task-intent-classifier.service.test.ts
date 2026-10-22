import { Effect } from 'effect'
import { describe, expect, test } from 'vitest'

import { makeTaskIntentClassifier } from './task-intent-classifier.service'

describe('TaskIntentClassifier', () => {
	test('falls back to implementation when classification fails', async () => {
		const classifier = makeTaskIntentClassifier(async () => {
			throw new Error('model unavailable')
		})

		await expect(Effect.runPromise(classifier.classify('Fix task launch'))).resolves.toBe('implementation')
	})
})
