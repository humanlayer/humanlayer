import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { inferDesignDocQuestionCounts } from '../../src/agents/design-doc-open-questions/design-doc-open-questions'

vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as object),
		Output: {
			object: vi.fn((value) => value),
		},
		generateText: vi.fn(async () => ({ output: { numOpenQuestions: 2, numResolvedQuestions: 1 } })),
	}
})

describe('inferDesignDocQuestionCounts', () => {
	it('passes doc content to the model prompt and returns structured counts', async () => {
		const docContent = 'sentinel-design-doc'

		const result = await inferDesignDocQuestionCounts(docContent)

		expect(result).toEqual({ numOpenQuestions: 2, numResolvedQuestions: 1 })
		expect(vi.mocked(generateText)).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.stringContaining(`<document>\n${docContent}\n</document>`),
			}),
		)
	})
})
