/**
 * Privacy redaction for UNCLAIMED human commits — work HumanLayer had nothing to do with.
 *
 * Commits some attribution method claimed (see ./attribute-commit: a trailer, a journal
 * overlap) are "ours": full metadata is the product. A commit NO
 * method claimed (tier `human`) is somebody else's work that merely shares a repo with
 * an agent session; the ledger keeps it COUNTABLE (sha, repo, timestamps, aggregate numstat —
 * the denominator and the leak-trend signal) but its content must never leave the machine: no
 * message, no author identity, no per-file paths, no branch name. Callers apply this BEFORE
 * transmitting, so the sensitive fields are never even sent.
 *
 * The redaction is an ALLOWLIST, deliberately: a new commit field (a richer author object,
 * message HTML, per-file detail) stays on the machine until someone consciously allows it —
 * stripping known-bad fields would instead transmit every future field by default. The list
 * itself is the caller's, because it names the caller's transmission schema (the daemon passes
 * the contract's `COMMIT_COUNTING_FIELDS`, exported next to `CommitSchema` and type-checked
 * against it); this module owns only the mechanism and the emptied `subject`.
 */

/** Minimum shape the redaction operates on; real inputs are full commit records. */
export type RedactableCommit = {
	subject: string
}

export function redactCleanHumanCommit<T extends RedactableCommit>(
	commit: T,
	countingFields: ReadonlyArray<string>,
): T {
	const kept: Record<string, unknown> = { subject: '' }
	for (const field of countingFields) {
		if (field in commit) kept[field] = (commit as Record<string, unknown>)[field]
	}
	return kept as T
}
