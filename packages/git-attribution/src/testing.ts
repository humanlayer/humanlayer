/**
 * `@humanlayer/git-attribution/testing` — the VERIFICATION surface, for consumers' tests only.
 *
 * Production code integrates through the main entry's two caller stories (arm + record on the
 * write side, attribute + redact + journal lifecycle on the read side). Tests additionally need
 * to reach through those composites and inspect the evidence they produce — parse a stamped
 * trailer back, seed a journal directly, construct expected line-hashes, or make temp-repo git
 * hermetic. That vocabulary lives here so the production seam stays exactly as narrow as its
 * callers.
 */

// Hermetic git config for temp-repo suites (global/system gitconfig pinned to /dev/null).
export { useHermeticGitConfig } from './git-test-env'

// Trailer vocabulary: build what the write side stamps, parse back what a commit carries.
export { commitReportsSession, parseSessionFromTrailer, sessionCommitUrl } from './evidence/trailer/session-trailer'

// Journal-overlap evidence: seed a journal directly, name its file, build expected hashes.
export { authorshipJournalPath, recordAgentEditToJournal } from './evidence/journal-overlap/authorship-journal'
export { hashLine, normalizeLine } from './shared/line-hash'
