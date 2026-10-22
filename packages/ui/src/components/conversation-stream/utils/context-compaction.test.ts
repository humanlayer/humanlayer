import { describe, expect, it } from 'vitest'
import { contextCompactionTokensLabel, parseContextCompaction, parseContextCompactionSummary } from './context-compaction'

const compactionContent = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({ kind: 'context_compaction', trigger: 'manual', ...overrides })

describe('parseContextCompaction', () => {
	it('parses a full boundary payload', () => {
		const content = compactionContent({ preTokens: 41297, postTokens: 2697, durationMs: 11388 })
		expect(parseContextCompaction({ eventType: 'system', content })).toEqual({
			trigger: 'manual',
			preTokens: 41297,
			postTokens: 2697,
			durationMs: 11388,
		})
	})

	it('returns null for non-system events even with compaction-shaped content', () => {
		const content = compactionContent({ preTokens: 1, postTokens: 1 })
		expect(parseContextCompaction({ eventType: 'message', content })).toBeNull()
	})

	it('returns null for missing or empty content', () => {
		expect(parseContextCompaction({ eventType: 'system', content: undefined })).toBeNull()
		expect(parseContextCompaction({ eventType: 'system', content: '' })).toBeNull()
	})

	it('returns null for non-JSON content', () => {
		expect(parseContextCompaction({ eventType: 'system', content: 'not json' })).toBeNull()
	})

	it('returns null for JSON that is not a compaction record', () => {
		expect(parseContextCompaction({ eventType: 'system', content: '[1,2,3]' })).toBeNull()
		expect(parseContextCompaction({ eventType: 'system', content: '"context_compaction"' })).toBeNull()
		expect(parseContextCompaction({ eventType: 'system', content: '{"kind":"other"}' })).toBeNull()
	})

	it('drops non-finite and negative token counts', () => {
		const content = compactionContent({ preTokens: null, postTokens: -5, durationMs: 'soon' })
		expect(parseContextCompaction({ eventType: 'system', content })).toEqual({ trigger: 'manual' })
	})

	it('treats any trigger other than auto as manual', () => {
		const auto = compactionContent({ trigger: 'auto' })
		const bogus = compactionContent({ trigger: 'threshold' })
		expect(parseContextCompaction({ eventType: 'system', content: auto })?.trigger).toBe('auto')
		expect(parseContextCompaction({ eventType: 'system', content: bogus })?.trigger).toBe('manual')
	})
})

const pre = (41297).toLocaleString()
const post = (2697).toLocaleString()

describe('contextCompactionTokensLabel', () => {
	it('formats the pair and returns empty when incomplete', () => {
		expect(contextCompactionTokensLabel({ trigger: 'manual', preTokens: 41297, postTokens: 2697 })).toBe(
			`${pre} → ${post}`,
		)
		expect(contextCompactionTokensLabel({ trigger: 'manual', postTokens: 2697 })).toBe('')
	})
})

describe('parseContextCompactionSummary', () => {
	const summaryContent = (overrides: Record<string, unknown> = {}) =>
		JSON.stringify({
			kind: 'context_compaction_summary',
			boundaryEventId: 'boundary-1',
			summary: '# Summary\n\nThe work so far.',
			...overrides,
		})

	it('parses a summary payload', () => {
		expect(parseContextCompactionSummary({ eventType: 'system', content: summaryContent() })).toEqual({
			boundaryEventId: 'boundary-1',
			summary: '# Summary\n\nThe work so far.',
		})
	})

	it('returns null for boundary payloads and non-system events', () => {
		const boundary = JSON.stringify({ kind: 'context_compaction', trigger: 'manual' })
		expect(parseContextCompactionSummary({ eventType: 'system', content: boundary })).toBeNull()
		expect(parseContextCompactionSummary({ eventType: 'message', content: summaryContent() })).toBeNull()
	})

	it('returns null when the boundary id or summary is missing or empty', () => {
		expect(parseContextCompactionSummary({ eventType: 'system', content: summaryContent({ summary: '' }) })).toBeNull()
		expect(
			parseContextCompactionSummary({ eventType: 'system', content: summaryContent({ boundaryEventId: 7 }) }),
		).toBeNull()
		expect(parseContextCompactionSummary({ eventType: 'system', content: 'not json' })).toBeNull()
	})
})
