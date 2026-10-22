import { describe, expect, test } from 'vitest'

import { mergeModelUsage } from './merge-model-usage'

describe('mergeModelUsage', () => {
	test('sums token counts field-wise for models present in both reports', () => {
		const merged = mergeModelUsage(
			{
				'claude-sonnet-4-5': {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 1000,
					cache_creation_input_tokens: 200,
				},
			},
			{
				'claude-sonnet-4-5': {
					input_tokens: 30,
					output_tokens: 20,
					cache_read_input_tokens: 500,
					cache_creation_input_tokens: 100,
				},
			},
		)

		expect(merged).toEqual({
			'claude-sonnet-4-5': {
				input_tokens: 130,
				output_tokens: 70,
				cache_read_input_tokens: 1500,
				cache_creation_input_tokens: 300,
			},
		})
	})

	test('keeps models only present in the existing usage and adds models only present in the incoming report', () => {
		const merged = mergeModelUsage(
			{ 'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 50 } },
			{ 'claude-haiku-4-5': { input_tokens: 10, output_tokens: 5 } },
		)

		expect(merged).toEqual({
			'claude-sonnet-4-5': { input_tokens: 100, output_tokens: 50 },
			'claude-haiku-4-5': { input_tokens: 10, output_tokens: 5 },
		})
	})

	test('treats missing optional cache fields as zero when the other side has a value', () => {
		const merged = mergeModelUsage(
			{ 'claude-sonnet-4-5': { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100 } },
			{ 'claude-sonnet-4-5': { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 40 } },
		)

		expect(merged).toEqual({
			'claude-sonnet-4-5': {
				input_tokens: 2,
				output_tokens: 2,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 40,
			},
		})
	})

	test('omits optional cache fields when absent from both sides', () => {
		const merged = mergeModelUsage(
			{ 'claude-sonnet-4-5': { input_tokens: 1, output_tokens: 1 } },
			{ 'claude-sonnet-4-5': { input_tokens: 2, output_tokens: 2 } },
		)

		expect(merged['claude-sonnet-4-5']).not.toHaveProperty('cache_read_input_tokens')
		expect(merged['claude-sonnet-4-5']).not.toHaveProperty('cache_creation_input_tokens')
	})

	test('merging into empty existing usage returns the incoming report', () => {
		const incoming = {
			'claude-sonnet-4-5': { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
		}

		expect(mergeModelUsage({}, incoming)).toEqual(incoming)
	})

	test('does not mutate its inputs', () => {
		const existing = { 'claude-sonnet-4-5': { input_tokens: 1, output_tokens: 1 } }
		const incoming = { 'claude-sonnet-4-5': { input_tokens: 2, output_tokens: 2 } }

		mergeModelUsage(existing, incoming)

		expect(existing).toEqual({ 'claude-sonnet-4-5': { input_tokens: 1, output_tokens: 1 } })
		expect(incoming).toEqual({ 'claude-sonnet-4-5': { input_tokens: 2, output_tokens: 2 } })
	})
})
