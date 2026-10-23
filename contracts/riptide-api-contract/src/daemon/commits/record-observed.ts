import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'
import { CommitSchema, COMMIT_BATCH_LIMIT } from '../sessions/commits/record'

// One commit observed by the daemon's HEAD-watch. Every field of a session-scoped
// CommitSchema plus the attribution tier the daemon tags each commit with
// (see commits table). A 'human' commit carries no attributedSessionId.
export const ObservedCommitSchema = CommitSchema.extend({
	attributionMethod: z.enum(['confirmed', 'inferred', 'human']),
	// The session this commit is attributed to; absent for a 'human' commit.
	attributedSessionId: z.uuid().optional(),
	aiConfidence: z.number().min(0).max(1), // 1.0 confirmed · match-fraction inferred · 0.0 human
	aiAttributedLines: z.number().int().nonnegative().optional(), // matched added lines
	attributionAlgorithmVersion: z.number().int(), // matcher versioned independently of capture
})

// No top-level sessionId: attribution is per-commit (a batch mixes attributed and
// human commits), so each entry carries its own attributedSessionId.
export const RecordObservedInputSchema = z.object({
	commits: z.array(ObservedCommitSchema).min(1).max(COMMIT_BATCH_LIMIT),
})

/** No transactionId: the table is not Electric-synced, nothing consumes a txid. */
export const RecordObservedOutputSchema = z.object({
	/** Rows actually inserted (excludes SHA-dedupe skips). */
	recorded: z.number().int(),
})

export const recordObservedCommitsContract = contractBuilder
	.input(RecordObservedInputSchema)
	.output(RecordObservedOutputSchema)
