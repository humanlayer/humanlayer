import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

// Input schema - one batch of commits observed during a run's watermark scan
// (baseline HEAD at run start -> HEAD at run end), one entry per SHA.
export const CommitSchema = z.object({
	sha: z.string().regex(/^[0-9a-f]{40,64}$/),
	parentShas: z.array(z.string()).max(16),
	branch: z.string().max(512).optional(),
	repoRemoteUrl: z.string().max(2048).optional(),
	repoFullName: z.string().max(512).optional(),
	repoDirectory: z.string().max(2048).optional(),
	subject: z.string().max(512),
	body: z.string().max(10_000).optional(),
	authorName: z.string().max(512).optional(),
	authorEmail: z.string().max(512).optional(),
	authoredAt: z.number().int().optional(), // epoch ms
	committedAt: z.number().int(), // epoch ms
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	filesChanged: z.number().int().nonnegative(),
	fileStats: z
		.array(
			z.object({
				path: z.string().max(2048),
				additions: z.number().int(),
				deletions: z.number().int(),
				binary: z.boolean().optional(),
				// Content-derived id of this file's diff (v3+); see commits.file_stats.
				changeId: z.string().max(64).optional(),
			}),
		)
		.max(500)
		.optional(),
	coAuthoredByAgent: z.boolean(),
	captureAlgorithmVersion: z.number().int(),
	// v3+ capture context (see the commits table for full semantics). All optional:
	// older daemons omit them and the columns stay null.
	changeId: z.string().max(64).optional(), // sha-independent content id (rebase/cherry-pick dedup)
	isPrimaryBranch: z.boolean().optional(), // HEAD was on the repo's default branch at capture
	authorMatchesDaemonUser: z.boolean().optional(), // author email == daemon machine's git user.email
})

/**
 * The ONLY CommitSchema fields an unclaimed bystander ("clean human") commit may carry off the
 * machine — the counting fields: identity for idempotency, repo/time coordinates, and aggregate
 * numstat. Owned HERE, next to the schema, so a field added to CommitSchema stays on-machine
 * until someone consciously adds it to this list (the daemon passes it to
 * `redactCleanHumanCommit`); `satisfies` keeps every name honest against the schema.
 */
export const COMMIT_COUNTING_FIELDS = [
	'sha',
	'parentShas',
	'repoRemoteUrl',
	'repoFullName',
	'repoDirectory',
	'authoredAt',
	'committedAt',
	'additions',
	'deletions',
	'filesChanged',
	'coAuthoredByAgent',
	'captureAlgorithmVersion',
	// changeId is a hash-of-hashes fingerprint (same disclosure class as `sha`: identifies,
	// never reconstructs content) and bystander commits need it most — dedup of THEIR squash
	// re-landings keeps the denominator honest. Per-file ids stay behind: they ride in
	// fileStats, which this list already withholds (no per-file detail leaves the machine).
	'changeId',
	// One bit each, no content: landed-vs-branch context, and the my-work-vs-observed
	// discriminator — the redacted 'human' tier is exactly where that distinction lives
	// (the daemon user's OWN hand-written commits are 'human' too).
	'isPrimaryBranch',
	'authorMatchesDaemonUser',
] as const satisfies ReadonlyArray<keyof z.infer<typeof CommitSchema>>

/**
 * Max commits accepted per record call. The daemon caps each repo's scan at this limit, but a
 * multi-repo workspace aggregates across repos, so the daemon must chunk its batches to this size
 * before sending — shared here so the chunk size and the input cap can never drift apart.
 */
export const COMMIT_BATCH_LIMIT = 200

export const RecordCommitsInputSchema = z.object({
	sessionId: z.uuid(),
	commits: z.array(CommitSchema).min(1).max(COMMIT_BATCH_LIMIT),
})

/** No transactionId: the table is not Electric-synced, nothing consumes a txid. */
export const RecordCommitsOutputSchema = z.object({
	/** Rows actually inserted (excludes SHA-dedupe skips). */
	recorded: z.number().int(),
})

export const recordCommitsContract = contractBuilder.input(RecordCommitsInputSchema).output(RecordCommitsOutputSchema)
