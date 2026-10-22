import { describe, expect, test } from 'vitest'

import { ATTRIBUTION_METHODS, attributeCommit } from './attribute-commit'
import type { CommitForAttribution } from './evidence/method'
import { SESSION_TRAILER_TOKEN, sessionCommitUrl } from './evidence/trailer/session-trailer'
import { buildLineHashSet } from './shared/line-hash'

const APP_ORIGIN = 'https://app.test'

// Real session ids are UUIDs, and the trailer parser only accepts UUID-shaped segments
// (anything else must not ride into recordObserved as an attributedSessionId).
const SESSION_A = '018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f'
const SESSION_B = '019b049c-950d-7baa-b9a8-b9364599319b'

/** A commit body carrying the `HumanLayer-Session` trailer for a session (as the hook would stamp). */
function trailerBody(sessionId: string): string {
	return `did the thing\n\n${SESSION_TRAILER_TOKEN}: ${sessionCommitUrl(APP_ORIGIN, sessionId)}`
}

/** A minimal commit with every required evidence field, overridable per test. */
function commit(overrides: Partial<CommitForAttribution>): CommitForAttribution {
	return { addedLines: [], candidates: [], ...overrides }
}

describe('ATTRIBUTION_METHODS registry', () => {
	test('the registry IS the chain: strength order, tier per method, every method enabled', () => {
		expect(ATTRIBUTION_METHODS.map((entry) => [entry.method.name, entry.tier])).toEqual([
			['trailer', 'confirmed'],
			['journal-overlap', 'inferred'],
		])
		expect(ATTRIBUTION_METHODS.every((entry) => entry.enabled)).toBe(true)
	})
})

describe('attributeCommit — trailer method', () => {
	test('trailer => confirmed with the trailer session and confidence 1', () => {
		const result = attributeCommit(
			commit({ body: trailerBody(SESSION_A), addedLines: ['line one', 'line two', '', '   '] }),
		)
		expect(result.tier).toBe('confirmed')
		expect(result.sessionId).toBe(SESSION_A)
		expect(result.confidence).toBe(1)
		// Only the two non-trivial lines are credited (empty + whitespace-only excluded).
		expect(result.aiAttributedLines).toBe(2)
	})

	test('trailer wins even when candidates could infer', () => {
		const result = attributeCommit(
			commit({
				body: trailerBody(SESSION_A),
				addedLines: ['const a = 1'],
				candidates: [{ sessionId: 'sess-other', authorship: buildLineHashSet(['const a = 1']) }],
			}),
		)
		expect(result.tier).toBe('confirmed')
		expect(result.sessionId).toBe(SESSION_A)
	})

	test('a malformed (non-UUID) trailer is NOT a session reference — never confirmed', () => {
		// A garbage segment riding through as sessionId would fail the recordObserved
		// contract's z.uuid() and wedge the whole batch — the incident failure class.
		const malformed = `did the thing\n\n${SESSION_TRAILER_TOKEN}: https://x/sessions/oops-not-a-uuid`
		const unclaimedByTrailer = attributeCommit(commit({ body: malformed, addedLines: ['a'] }))
		expect(unclaimedByTrailer.tier).toBe('human')
		expect(unclaimedByTrailer.sessionId).toBeUndefined()
		// Unclaimed means the caller redacts it — even our own token with a broken value keeps
		// nothing; it just heaps with the human commits (no kept-but-unclaimed middle class).

		// With matching candidates it degrades to inferred, not confirmed-with-garbage.
		const lines = ['const a = 1', 'const b = 2', 'const c = 3']
		const asInferred = attributeCommit(
			commit({
				body: malformed,
				addedLines: lines,
				candidates: [{ sessionId: SESSION_B, authorship: buildLineHashSet(lines) }],
			}),
		)
		expect(asInferred.tier).toBe('inferred')
		expect(asInferred.sessionId).toBe(SESSION_B)
	})
})

describe('attributeCommit — journal-overlap method', () => {
	test('partial overlap => inferred with the matched fraction as confidence', () => {
		// 4 unique added lines; the candidate authored 3 of them => confidence 3/4 = 0.75.
		const result = attributeCommit(
			commit({
				addedLines: ['const a = 1', 'const b = 2', 'const c = 3', 'const d = 4'],
				candidates: [
					{
						sessionId: 'sess-inferred',
						authorship: buildLineHashSet(['const a = 1\nconst b = 2\nconst c = 3']),
					},
				],
			}),
		)
		expect(result.tier).toBe('inferred')
		expect(result.sessionId).toBe('sess-inferred')
		expect(result.confidence).toBe(0.75)
		expect(result.aiAttributedLines).toBe(3)
	})

	test('picks the candidate with the best overlap', () => {
		const result = attributeCommit(
			commit({
				addedLines: ['x = 1', 'y = 2', 'z = 3', 'w = 4'],
				candidates: [
					{ sessionId: 'weak', authorship: buildLineHashSet(['x = 1']) },
					{ sessionId: 'strong', authorship: buildLineHashSet(['x = 1\ny = 2\nz = 3']) },
				],
			}),
		)
		expect(result.tier).toBe('inferred')
		expect(result.sessionId).toBe('strong')
		expect(result.confidence).toBe(0.75)
		expect(result.aiAttributedLines).toBe(3)
	})

	test('whitespace-only differences still count as an overlap (normalization)', () => {
		const result = attributeCommit(
			commit({
				addedLines: ['foo   bar', 'baz  qux', 'quux   corge'], // reformatted before commit
				candidates: [{ sessionId: 'sess-ws', authorship: buildLineHashSet(['foo bar\nbaz qux\nquux corge']) }],
			}),
		)
		expect(result.tier).toBe('inferred')
		expect(result.sessionId).toBe('sess-ws')
		expect(result.confidence).toBe(1)
		expect(result.aiAttributedLines).toBe(3)
	})

	test('a single boilerplate collision => unclaimed HUMAN (the v1 false-positive class, closed in v2)', () => {
		// Under v1 (any-overlap floor) one shared `}` tagged the whole commit as agent work — a
		// measured 61% FP rate. 1 of 4 lines (fraction 0.25 but below the 3-line minimum) => human.
		const result = attributeCommit(
			commit({
				addedLines: ['const a = 1', 'const b = 2', 'const c = 3', '}'],
				candidates: [{ sessionId: 'sess-sliver', authorship: buildLineHashSet(['}']) }],
			}),
		)
		expect(result.tier).toBe('human')
		expect(result.sessionId).toBeUndefined()
	})

	test('a small commit that is substantially agent work clears the fraction gate', () => {
		// 3 of 4 unique lines (0.75 >= 0.25, matched >= 3): the absolute floor of 10 would lose
		// this — the fraction arm exists exactly for small verbatim-committed agent fixes.
		const result = attributeCommit(
			commit({
				addedLines: ['alpha()', 'beta()', 'gamma()', 'delta()'],
				candidates: [{ sessionId: 'sess-small', authorship: buildLineHashSet(['alpha()\nbeta()\ngamma()']) }],
			}),
		)
		expect(result.tier).toBe('inferred')
		expect(result.sessionId).toBe('sess-small')
	})

	test('a large commit clears the absolute floor even at a low matched fraction', () => {
		// 10 matched lines in a 100-line commit: fraction 0.1 (< 0.25) but matched >= 10.
		const authored = Array.from({ length: 10 }, (_, i) => `agent_line_${i} = compute(${i})`)
		const humanLines = Array.from({ length: 90 }, (_, i) => `human_line_${i} = write(${i})`)
		const result = attributeCommit(
			commit({
				addedLines: [...authored, ...humanLines],
				candidates: [{ sessionId: 'sess-large', authorship: buildLineHashSet([authored.join('\n')]) }],
			}),
		)
		expect(result.tier).toBe('inferred')
		expect(result.sessionId).toBe('sess-large')
		expect(result.aiAttributedLines).toBe(10)
	})

	test('exact-overlap ties resolve deterministically by session id, not Map order', () => {
		// Two sessions authored the SAME lines (shared boilerplate between concurrent sessions).
		// A tie carries no distinguishing evidence — the winner must at least be STABLE across
		// runs, in either candidate order.
		const lines = ['shared_a()', 'shared_b()', 'shared_c()']
		const authorship = () => buildLineHashSet([lines.join('\n')])
		for (const candidates of [
			[
				{ sessionId: 'sess-b', authorship: authorship() },
				{ sessionId: 'sess-a', authorship: authorship() },
			],
			[
				{ sessionId: 'sess-a', authorship: authorship() },
				{ sessionId: 'sess-b', authorship: authorship() },
			],
		]) {
			const result = attributeCommit(commit({ addedLines: lines, candidates }))
			expect(result.tier).toBe('inferred')
			expect(result.sessionId).toBe('sess-a')
		}
	})
})

describe('attributeCommit — the unclaimed human fallback', () => {
	test('a Co-Authored-By agent line alone is NOT a claim — it proves some agent tool, not HumanLayer', () => {
		// Claude Code standalone, Codex, Cursor all write co-author lines. Without a HumanLayer
		// signal this is bystander work: unclaimed, so the caller redacts it to counting fields
		// (which include the collection-time coAuthoredByAgent boolean — the trend survives).
		const result = attributeCommit(
			commit({ body: 'looks human\n\nCo-Authored-By: Claude <noreply@anthropic.com>' }),
		)
		expect(result.tier).toBe('human')
		expect(result.sessionId).toBeUndefined()
		expect(result.confidence).toBe(0)
	})

	test('no line overlap => unclaimed human', () => {
		const result = attributeCommit(
			commit({
				addedLines: ['const a = 1', 'const b = 2'],
				candidates: [{ sessionId: 'sess-none', authorship: buildLineHashSet(['a totally unrelated line']) }],
			}),
		)
		expect(result.tier).toBe('human')
		expect(result.sessionId).toBeUndefined()
		expect(result.confidence).toBe(0)
		expect(result.aiAttributedLines).toBe(0)
	})

	test('no evidence at all => unclaimed human', () => {
		const result = attributeCommit(commit({ addedLines: ['const a = 1'] }))
		expect(result.tier).toBe('human')
		expect(result.sessionId).toBeUndefined()
	})
})

describe('attributeCommit — per-method disabling (misbehavior isolation)', () => {
	const lines = ['iso_a()', 'iso_b()', 'iso_c()']
	const evidenceForBoth = commit({
		body: trailerBody(SESSION_A),
		addedLines: lines,
		candidates: [{ sessionId: SESSION_B, authorship: buildLineHashSet(lines) }],
	})

	test('disabling a method hands its claims to the NEXT method in the chain', () => {
		// Both methods would claim this commit; peeling them off one by one walks the chain.
		expect(attributeCommit(evidenceForBoth).tier).toBe('confirmed')
		const noTrailer = attributeCommit(evidenceForBoth, { disabledMethods: ['trailer'] })
		expect(noTrailer.tier).toBe('inferred')
		expect(noTrailer.sessionId).toBe(SESSION_B)
		const none = attributeCommit(evidenceForBoth, { disabledMethods: ['trailer', 'journal-overlap'] })
		expect(none.tier).toBe('human')
		expect(none.sessionId).toBeUndefined()
	})
})
