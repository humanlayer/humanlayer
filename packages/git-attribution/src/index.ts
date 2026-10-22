/**
 * @humanlayer/git-attribution — the shared core of commit attribution.
 *
 * The package is organized as one folder per KIND OF EVIDENCE (src/evidence/<name>), each the
 * full lifecycle of one attribution method — the write side (how the evidence gets produced)
 * and the read side (the pure claim function that interprets it) together, because the two
 * halves share a format contract that must never drift. The sequencer (src/attribute-commit)
 * is the ONE place that lists the methods, their enabled flags, their order, and the ledger
 * tier each one books as:
 *
 *   - evidence/trailer          `confirmed` — env-carried session identity + env-hosted
 *                              `prepare-commit-msg` hook stamp a `HumanLayer-Session` trailer
 *                              on every commit an agent process makes
 *   - evidence/journal-overlap  `inferred` — every harness journals the line-hashes an agent
 *                              authors; a later commit of those lines (typically by the human)
 *                              is matched by content overlap, gated against boilerplate
 *
 * A commit neither method claims books as `human` and is ALWAYS redacted to counting fields —
 * there is no kept-but-unclaimed middle class (see AttributionTier in ./attribute-commit).
 *
 * A second sequencer (src/attribute-pull-request) attributes the sessions on a pull request's
 * head branch with the same shape — registry, order, first claim wins, fallthrough tier:
 *
 *   - evidence/commit-ledger    `committed` — the ledger the commit chain writes holds a commit
 *                              of the session on the branch
 *
 * A session on the branch that no method claims books as `observed`, kept but excluded from the
 * pull request metrics.
 *
 * This surface is exactly the two caller stories, and nothing else:
 *
 *   WRITE (every harness): resolve the gate, arm at session start, record activity per tool
 *   call — the granular pieces (trailer vocabulary, hooks-dir plumbing, journal
 *   writer) are composed inside ./session-attribution and are not part of the seam.
 *
 *   READ (the daemon HEAD-watch): attribute each observed commit through the method chain,
 *   redact what no method claimed, and manage the journal lifecycle the inferred tier feeds on.
 *
 * Vocabulary that only VERIFICATION needs (the other trailer helpers, journal file naming, hash
 * primitives, the granular installer) lives behind `@humanlayer/git-attribution/testing`.
 */

// The one attribution knob is the org's `commit_tracking_enabled` opt-in; this is the env var
// through which a launcher carries that answer into processes that cannot query it (see ./gate).
export { COMMIT_TRACKING_ENV_VAR } from './gate'

// WRITE side — the whole harness integration: arm once, record per tool call. The stamper is
// self-contained POSIX sh hosted in OUR state dir (see session-hooks-dir), reached only through
// the env-scoped git config that arming returns — the user's repo carries zero HumanLayer bytes.
export type { ArmOutcome, ArmResult } from './session-attribution'
export { armSessionAttribution, armSessionHooks, recordAgentActivity } from './session-attribution'

// READ side — the method chain over one observed commit, and the redaction keyed off its tier.
export { ATTRIBUTION_ALGORITHM_VERSION, attributeCommit, type AttributionResult } from './attribute-commit'
export { redactCleanHumanCommit } from './redact-human-commit'

// READ side — the method chain over the sessions on a pull request's head branch (the API links
// a pull request to its sessions with it), and the tier vocabulary the ledger stores.
export {
	type AttributedBranchSession,
	attributePullRequest,
	BRANCH_ATTRIBUTION_WINDOW_MS,
	PULL_REQUEST_ATTRIBUTION_TIERS,
	PULL_REQUEST_COUNTED_TIERS,
	type PullRequestAttributionResult,
	type PullRequestAttributionTier,
	type PullRequestForAttribution,
	pullRequestTierRank,
} from './attribute-pull-request'
export type { BranchSessionEvidence } from './evidence/method'

// READ side — the session a commit message's trailer names. The API reads a pull request's head
// commit with it when no session observed the branch.
export { parseSessionFromTrailer } from './evidence/trailer/session-trailer'

// READ side — journal lifecycle: candidates' evidence, the terminal-session liveness signal,
// and the retention floor that keeps the on-disk store bounded.
export {
	JOURNAL_MAX_AGE_MS,
	listAuthorshipJournals,
	readAuthorshipJournal,
	removeAuthorshipJournal,
	sweepAuthorshipJournals,
} from './evidence/journal-overlap/authorship-journal'
