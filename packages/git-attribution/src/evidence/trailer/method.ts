import { countNormalizedLines } from '../../shared/line-hash'
import type { AttributionMethod } from '../method'
import { parseSessionFromTrailer } from './session-trailer'

/**
 * The TRAILER method — the `confirmed` tier. The strongest evidence there is: the commit
 * message itself carries a `HumanLayer-Session` trailer, stamped at commit time by the
 * repo-local `prepare-commit-msg` hook when the committing process's `HUMANLAYER_SESSION_ID`
 * env carried a live (unexpired) session identity (see ./session-hooks-dir and ./hook-scripts for the write
 * side). If this method claims a commit, an agent process demonstrably created it.
 *
 * When the trailer is ABSENT on agent work, it is for one of these write-side reasons — each a
 * deliberate miss this method must not paper over (the later methods in the chain pick up what
 * they can):
 *   - the committing process was the HUMAN's (their shell, IDE, GitHub Desktop): no env, by
 *     design — journal-overlap is the only method that can ever claim these;
 *   - the hook install declined (husky/`core.hooksPath` repo) or failed (read-only `.git`);
 *   - the env outlived its expiry horizon (a leak into a long-lived process);
 *   - the repo opted out (`git config humanlayer.attribution false`);
 *   - the harness is not wired yet (opencode).
 */
export const trailerMethod: AttributionMethod = {
	name: 'trailer',
	claim(commit) {
		const sessionId = parseSessionFromTrailer(commit.body)
		if (sessionId === undefined) return undefined
		return {
			sessionId,
			confidence: 1,
			// Credited with every normalized non-null added line: the agent committed the lot.
			aiAttributedLines: countNormalizedLines(commit.addedLines),
		}
	},
}
