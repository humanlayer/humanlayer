import { buildLineHashSet } from '../../shared/line-hash'
import type { AttributionMethod } from '../method'

/**
 * The JOURNAL-OVERLAP method — the `inferred` tier. No trailer, but the commit's added lines
 * overlap (by normalized-line SHA-1) the lines an agent authored during a session, as captured
 * in the authorship journal (./authorship-journal, fed by ./agent-edit from every harness's
 * tool stream).
 *
 * Two distinct situations land here, and only this method can claim either:
 *   - a HUMAN committed the agent's work (their commit process carries no session env, so the
 *     trailer method structurally cannot see it — this is not a degraded trailer, it is the one
 *     method that measures agent-code adoption by humans);
 *   - the agent's OWN commit in a repo where the hook could not stamp (husky/`core.hooksPath`
 *     an unarmed launcher, env past its expiry horizon).
 *
 * Content matching is by normalized-line SHA-1 (../../shared/line-hash): trivial whitespace
 * differences collapse together so a reformat between edit and commit does not drop the match,
 * and empty/whitespace-only lines are dropped so boilerplate can't inflate the overlap.
 */

/**
 * The v1 gate — one matched line tags the whole commit — was measured at a 61% false-positive
 * rate against 784 real commits: boilerplate lines (`}`, `})`, `return {`, common imports) hash
 * identically across unrelated code, so nearly every human commit shared SOME line with a live
 * session's authorship set (median attributed confidence was 0.073). The replacement requires the
 * overlap to be substantial in ABSOLUTE terms or in PROPORTION to the commit:
 *
 *   - `matched >= INFERRED_FLOOR_LINES` (10): at floor 10 the measured FP rate drops to ~24%,
 *     and real agent-authored commits of any size clear it comfortably; OR
 *   - `matched >= INFERRED_MIN_LINES` (3) AND `matched/total >= INFERRED_MIN_CONFIDENCE` (0.25):
 *     keeps recall on SMALL commits (a 4-line agent fix a human commits verbatim is 1.0
 *     confidence but could never reach an absolute floor of 10), while a lone `}` collision on a
 *     50-line commit (fraction 0.02) no longer books the commit as agent work.
 */
export const INFERRED_FLOOR_LINES = 10
export const INFERRED_MIN_LINES = 3
export const INFERRED_MIN_CONFIDENCE = 0.25

/**
 * Intersect the commit's added-line hashes with each candidate session's authored hashes; take
 * the best overlap. An exact tie carries no distinguishing evidence, so it resolves by session
 * id — arbitrary either way, but stable across runs instead of hostage to Map iteration order.
 * Claims only when the overlap clears the gate above.
 */
export const journalOverlapMethod: AttributionMethod = {
	name: 'journal-overlap',
	claim(commit) {
		if (commit.candidates.length === 0) return undefined
		const commitSet = buildLineHashSet(commit.addedLines)
		const total = commitSet.size
		const beats = (
			candidate: { sessionId: string; overlap: number },
			current: { sessionId: string; overlap: number },
		) => {
			if (candidate.overlap !== current.overlap) return candidate.overlap > current.overlap
			return candidate.sessionId < current.sessionId
		}
		let best: { sessionId: string; overlap: number } | undefined
		for (const candidate of commit.candidates) {
			let overlap = 0
			for (const hash of commitSet) {
				if (candidate.authorship.has(hash)) overlap++
			}
			const contender = { sessionId: candidate.sessionId, overlap }
			if (best === undefined || beats(contender, best)) best = contender
		}
		// overlap >= INFERRED_MIN_LINES guarantees total >= 1, so the confidence division is safe.
		if (
			best !== undefined &&
			(best.overlap >= INFERRED_FLOOR_LINES ||
				(best.overlap >= INFERRED_MIN_LINES && best.overlap / total >= INFERRED_MIN_CONFIDENCE))
		) {
			return {
				sessionId: best.sessionId,
				confidence: best.overlap / total,
				aiAttributedLines: best.overlap,
			}
		}
		return undefined
	},
}
