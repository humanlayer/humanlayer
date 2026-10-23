/**
 * The shape every attribution METHOD implements — one folder under ./evidence per KIND OF
 * EVIDENCE, one `method.ts` per folder exporting the single method that reads it.
 *
 * A method is one self-contained way of deciding whom a SUBJECT belongs to: it looks at one
 * kind of evidence and either CLAIMS the subject or passes. There are two subjects, each with
 * its own sequencer that runs the enabled methods in declared order and takes the first claim,
 * so disabling one method (to isolate misbehavior, or because its evidence source is broken on
 * some host) cleanly removes exactly that method's claims and nothing else:
 *
 *   - a COMMIT ({@link AttributionMethod}, ../attribute-commit): which session created it —
 *     trailer, then journal-overlap;
 *   - a SESSION ON A PULL REQUEST'S HEAD BRANCH ({@link PullRequestAttributionMethod},
 *     ../attribute-pull-request): whether the session's work is on the branch — the commit
 *     ledger.
 *
 * Each evidence folder deliberately co-locates the WRITE side (how the evidence gets produced —
 * a stamper, a journal writer) with this READ side: the two halves share a private contract
 * (trailer format, line-hash normalization) that must never drift, and a drift
 * would be silent — evidence that stops parsing simply books as `human`. One folder per
 * evidence kind means one directory to look in when a method misbehaves, producer included.
 * The folders differ wildly in where the work lives, and that is the design: trailer spends
 * its complexity at WRITE time (hook, stamper — the evidence is self-describing to
 * read), journal-overlap at READ time (cheap hash appends, an expensive matcher).
 *
 * The read side is PURE (no I/O): all evidence arrives in {@link CommitForAttribution},
 * gathered by the caller (the daemon HEAD-watch live, or the server-side backfill re-running
 * the same chain against stored bodies). That is what makes a method's behavior reproducible
 * in isolation: feed it the same input, get the same claim, no environment attached.
 */

/** Every commit method's name — the vocabulary of the disable list. */
export type AttributionMethodName = 'trailer' | 'journal-overlap'

/** Everything any commit method may look at, gathered once by the caller. */
export type CommitForAttribution = {
	/** Raw commit message body (subject + body), when available. */
	readonly body?: string
	/** The commit's added-line CONTENT (never leaves the machine — see the journal-overlap docs). */
	readonly addedLines: readonly string[]
	/** Per-session authored line-hash sets to match against (journal-overlap's evidence). */
	readonly candidates: ReadonlyArray<{ readonly sessionId: string; readonly authorship: ReadonlySet<string> }>
}

/**
 * A method's positive verdict — pure EVIDENCE, deliberately tier-free. What a claim books as in
 * the ledger (`confirmed`/`inferred`) is policy the sequencer's registry declares per
 * method (../attribute-commit), so the whole chain — order, enablement, and meaning — is
 * readable in one literal there. Returning undefined means "not mine — ask the next method".
 */
export type MethodClaim = {
	readonly sessionId?: string
	/** 1 for direct evidence (trailer); the matched fraction for content inference. */
	readonly confidence: number
	readonly aiAttributedLines: number
}

export type AttributionMethod = {
	readonly name: AttributionMethodName
	readonly claim: (commit: CommitForAttribution) => MethodClaim | undefined
}

/** Every pull request method's name — the vocabulary of its disable list. */
export type PullRequestAttributionMethodName = 'commit-ledger'

/**
 * One session's record on a pull request's head branch, gathered once by the caller. Being in
 * the input at all is the weakest evidence — the session had the branch checked out — and is
 * what the sequencer's fallthrough tier books.
 */
export type BranchSessionEvidence = {
	readonly sessionId: string
	/** Whether the commit ledger holds a commit this session made on the branch. */
	readonly committedOnBranch: boolean
	/** When the session last had the branch checked out, epoch ms. */
	readonly lastSeenAt: number
}

/**
 * A pull request method's positive verdict for one session: the method saw its evidence, or it
 * did not. Tier-free like {@link MethodClaim}; ../attribute-pull-request says what it books as.
 */
export type PullRequestAttributionMethod = {
	readonly name: PullRequestAttributionMethodName
	readonly claim: (session: BranchSessionEvidence) => boolean
}
