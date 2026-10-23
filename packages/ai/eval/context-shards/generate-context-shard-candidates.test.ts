import { describe, expect, setDefaultTimeout, test } from 'bun:test'

import * as Option from 'effect/Option'

import { generateContextShardCandidates } from '../../src/agents/context-shards'
import { buildEvalInput, getEvalMessageSession, parseEvalMessageId } from './fixtures'

setDefaultTimeout(120_000)

// Live opt-in eval: requires ANTHROPIC_API_KEY and is never part of the
// default test flow or CI. Run with:
//   ANTHROPIC_API_KEY=... bun --bun --cwd packages/ai run eval:context-shards

describe('generateContextShardCandidates (live)', () => {
	test('proposes a useful cross-user shard, honors semantic exclusions, and cites real evidence', async () => {
		// Unique seed busts any provider-side prompt caching between runs
		const seed = ` [eval-run-${Date.now()}-${Math.random().toString(36).slice(2)}]`
		const input = buildEvalInput(seed)
		const result = await generateContextShardCandidates(input)

		// Pretty-print all candidates for manual review
		console.log(`\n${'═'.repeat(80)}`)
		console.log('  GENERATED CONTEXT SHARD CANDIDATES')
		console.log('═'.repeat(80))
		for (let i = 0; i < result.candidates.length; i++) {
			const c = result.candidates[i]!
			console.log(`\n${'─'.repeat(80)}`)
			console.log(`  C${i + 1}: ${c.shard}`)
			console.log(`  reasoning: ${c.reasoning}`)
			for (const ex of c.examples) {
				console.log(`    [${ex.messageId} → ${getEvalMessageSession(ex.messageId) ?? '??'}] ${ex.citation}`)
			}
		}
		console.log(`\n${'═'.repeat(80)}\n`)

		// --- useful shard text: the repeated contract-test lesson must surface ---
		expect(result.candidates.length).toBeGreaterThanOrEqual(1)
		const contractCandidate = result.candidates.find(
			(c) => /contract test/i.test(c.shard) && /(response|api)/i.test(c.shard),
		)
		expect(contractCandidate).toBeDefined()

		// --- semantic exclusion: no candidate may re-propose excluded lessons ---
		for (const c of result.candidates) {
			expect(/canary/i.test(c.shard)).toBe(false)
			expect(/\b(bun|npm|yarn|pnpm)\b/i.test(c.shard)).toBe(false)
		}

		// --- citation quality: every example cites a real packed message ---
		for (const c of result.candidates) {
			expect(c.examples.length).toBeGreaterThanOrEqual(1)
			expect(c.examples.length).toBeLessThanOrEqual(5)
			for (const ex of c.examples) {
				expect(Option.isSome(parseEvalMessageId(ex.messageId))).toBe(true)
				expect(ex.citation.length).toBeGreaterThan(0)
				// A citation is an excerpt or concise identification, not a full transcript
				expect(ex.citation.length).toBeLessThan(500)
			}
			expect(c.reasoning.length).toBeGreaterThan(20)
		}

		// --- cross-user evidence: the contract-test lesson spans sessions s1/s2/s4 ---
		const citedSessions = new Set(
			contractCandidate!.examples.map((ex) => getEvalMessageSession(ex.messageId)).filter(Boolean),
		)
		expect(citedSessions.size).toBeGreaterThanOrEqual(2)
		// The lesson never appears in the noise session
		expect(citedSessions.has('s3')).toBe(false)

		// Its citations should point at messages that actually carry the lesson
		const evidenceByTag = new Map(
			buildEvalInput(seed)
				.sessions.flatMap((s) => s.messages)
				.map((m) => [m.messageId, m.content]),
		)
		for (const ex of contractCandidate!.examples) {
			const source = evidenceByTag.get(ex.messageId) ?? ''
			expect(/contract test|response/i.test(source)).toBe(true)
		}
	})
})
