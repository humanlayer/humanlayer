import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ContextShardInferenceInput, ContextShardInferenceOutput } from './generate-context-shard-candidates'

vi.mock('ai', async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as object),
		Output: {
			object: vi.fn((value) => value),
		},
		generateText: vi.fn(async () => ({
			output: {
				candidates: [
					{
						shard: 'Always update contract tests when an API response shape changes.',
						reasoning: 'Multiple users repeated this steering across sessions.',
						examples: [{ messageId: 'm1', citation: 'update contract tests when the response changes' }],
					},
				],
			},
		})),
	}
})

// Import after mocks are set up
const { generateContextShardCandidates, ContextShardInferenceError } =
	await import('./generate-context-shard-candidates')
const { generateText } = await import('ai')

function baseInput(): ContextShardInferenceInput {
	return {
		excludedReleasedShards: ['Use bun instead of npm for all package commands.'],
		excludedDismissedShards: ['The canary branch is the mainline branch.'],
		sessions: [
			{
				sessionTag: 's1',
				taskTag: 't1',
				messages: [
					{
						messageId: 'm1',
						role: 'user',
						content: 'Please update the contract tests when the response changes.',
					},
					{ messageId: 'm2', role: 'assistant', content: 'Updated the contract tests to match.' },
				],
			},
			{
				sessionTag: 's2',
				taskTag: null,
				messages: [
					{
						messageId: 'm3',
						role: 'user',
						content: 'Change contract tests whenever a response shape moves.',
					},
				],
			},
		],
	}
}

function mockOutputOnce(output: unknown) {
	vi.mocked(generateText).mockResolvedValueOnce({ output } as never)
}

function lastPrompt(): string {
	const call = vi.mocked(generateText).mock.calls.at(-1)
	if (!call) throw new Error('generateText was not called')
	return (call[0] as { prompt: string }).prompt
}

beforeEach(() => {
	vi.mocked(generateText).mockClear()
})

describe('generateContextShardCandidates', () => {
	test('returns validated candidates from structured output', async () => {
		const result = await generateContextShardCandidates(baseInput())
		expect(result.candidates).toHaveLength(1)
		expect(result.candidates[0]?.shard).toContain('contract tests')
		expect(result.candidates[0]?.examples[0]?.messageId).toBe('m1')
	})

	test('renders exclusion sections before conversation evidence, in released-then-dismissed order', async () => {
		await generateContextShardCandidates(baseInput())
		const prompt = lastPrompt()

		const releasedIndex = prompt.indexOf('<excluded_released_shards>')
		const dismissedIndex = prompt.indexOf('<excluded_dismissed_shards>')
		const evidenceIndex = prompt.indexOf('<conversation_evidence>')

		expect(releasedIndex).toBeGreaterThan(-1)
		expect(dismissedIndex).toBeGreaterThan(releasedIndex)
		expect(evidenceIndex).toBeGreaterThan(dismissedIndex)

		// Instructions come before every section
		expect(prompt.indexOf('context shards')).toBeLessThan(releasedIndex)

		expect(prompt).toContain('<shard>Use bun instead of npm for all package commands.</shard>')
		expect(prompt).toContain('<shard>The canary branch is the mainline branch.</shard>')
	})

	test('renders tagged sessions and messages, omitting task_id when the session has no task', async () => {
		await generateContextShardCandidates(baseInput())
		const prompt = lastPrompt()

		expect(prompt).toContain('<session id="s1" task_id="t1">')
		expect(prompt).toContain('<session id="s2">')
		expect(prompt).toContain(
			'<message id="m1" role="user">Please update the contract tests when the response changes.</message>',
		)
		expect(prompt).toContain('<message id="m2" role="assistant">Updated the contract tests to match.</message>')
	})

	test('renders empty exclusion sections when no exclusions exist', async () => {
		const input = baseInput()
		input.excludedReleasedShards = []
		input.excludedDismissedShards = []
		await generateContextShardCandidates(input)
		const prompt = lastPrompt()
		expect(prompt).toContain('<excluded_released_shards>\n</excluded_released_shards>')
		expect(prompt).toContain('<excluded_dismissed_shards>\n</excluded_dismissed_shards>')
	})

	test('escapes XML in message content and shard exclusions', async () => {
		const input = baseInput()
		input.excludedReleasedShards = ['Prefer <Suspense> & lazy() for code splitting.']
		input.sessions[0]!.messages[0]!.content = 'Use <div a="b"> & keep 1 < 2 in mind'
		await generateContextShardCandidates(input)
		const prompt = lastPrompt()

		expect(prompt).toContain('<shard>Prefer &lt;Suspense&gt; &amp; lazy() for code splitting.</shard>')
		expect(prompt).toContain(
			'<message id="m1" role="user">Use &lt;div a="b"&gt; &amp; keep 1 &lt; 2 in mind</message>',
		)
		expect(prompt).not.toContain('<div a="b">')
	})

	test('rejects invalid input before calling the model', async () => {
		const input = baseInput()
		input.sessions[0]!.messages[0]!.messageId = 'not-a-tag' as never
		await expect(generateContextShardCandidates(input)).rejects.toThrow(ContextShardInferenceError)
		expect(vi.mocked(generateText)).not.toHaveBeenCalled()
	})

	test('rejects when the model returns no structured output', async () => {
		mockOutputOnce(null)
		await expect(generateContextShardCandidates(baseInput())).rejects.toThrow(
			'context shard inference returned no structured output',
		)
	})

	test('rejects malformed structured output', async () => {
		mockOutputOnce({ candidates: [{ shard: '', reasoning: 'x', examples: [{ messageId: 'm1', citation: 'y' }] }] })
		await expect(generateContextShardCandidates(baseInput())).rejects.toThrow('malformed structured output')
	})

	test('rejects candidates with no examples', async () => {
		mockOutputOnce({ candidates: [{ shard: 'A shard', reasoning: 'because', examples: [] }] })
		await expect(generateContextShardCandidates(baseInput())).rejects.toThrow('malformed structured output')
	})

	test('rejects candidates with more than five examples', async () => {
		const examples = Array.from({ length: 6 }, (_, i) => ({ messageId: `m${(i % 3) + 1}`, citation: 'excerpt' }))
		mockOutputOnce({ candidates: [{ shard: 'A shard', reasoning: 'because', examples }] })
		await expect(generateContextShardCandidates(baseInput())).rejects.toThrow('malformed structured output')
	})

	test('rejects citation tags that violate the mN schema', async () => {
		for (const badTag of ['x1', 'm0', 'm01', 'm1a', 'M1', '1']) {
			mockOutputOnce({
				candidates: [
					{ shard: 'A shard', reasoning: 'because', examples: [{ messageId: badTag, citation: 'excerpt' }] },
				],
			})
			await expect(generateContextShardCandidates(baseInput())).rejects.toThrow('malformed structured output')
		}
	})

	test('rejects citations that reference unknown message tags', async () => {
		mockOutputOnce({
			candidates: [
				{ shard: 'A shard', reasoning: 'because', examples: [{ messageId: 'm99', citation: 'excerpt' }] },
			],
		})
		await expect(generateContextShardCandidates(baseInput())).rejects.toThrow('unknown message tag "m99"')
	})

	test('accepts an empty candidates list', async () => {
		mockOutputOnce({ candidates: [] })
		const result: ContextShardInferenceOutput = await generateContextShardCandidates(baseInput())
		expect(result.candidates).toEqual([])
	})
})
