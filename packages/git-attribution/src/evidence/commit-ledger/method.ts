import type { PullRequestAttributionMethod } from '../method'

/**
 * The COMMIT-LEDGER method — the `committed` tier. The commit ledger (the output of
 * ../../attribute-commit, one row per commit a method claimed for a session) holds a commit this
 * session made on the pull request's head branch. The ledger is written by the daemon HEAD-watch
 * as commits land; this method reads only whether such a row exists for the session and branch.
 * A session that only had the branch checked out has no such row and falls through to `observed`.
 */
export const commitLedgerMethod: PullRequestAttributionMethod = {
	name: 'commit-ledger',
	claim: (session) => session.committedOnBranch,
}
