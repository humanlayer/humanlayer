import { describe, expect, test, vi } from 'vitest'

vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as object),
		Output: {
			object: vi.fn((value) => value),
		},
		generateText: vi.fn(async () => ({ output: { title: 'Add Dark Mode' } })),
	}
})

// Import after mocks are set up
const { generateTaskSummary } = await import('./generate-task-summary')

describe('generateTaskSummary', () => {
	test('returns title from model output', async () => {
		const title = await generateTaskSummary('toggle dark mode')
		expect(title).toBe('Add Dark Mode')
	})

	test('returns Untitled Task when output is null', async () => {
		const { generateText } = await import('ai')
		vi.mocked(generateText).mockResolvedValueOnce({ output: null } as never)
		const title = await generateTaskSummary('toggle dark mode')
		expect(title).toBe('Untitled Task')
	})
})
