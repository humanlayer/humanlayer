import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

// Input schema - one append-only usage report per agent run, keyed by the run's
// usageReportKey (the same key sessions.update uses to merge the snapshot).
export const RecordSessionUsageInputSchema = z.object({
	sessionId: z.uuid(),
	/** Producer-generated idempotency key; stable across oRPC retries. */
	reportKey: z.string().min(1).max(128),
	// Only agent-run producers reach this procedure. The 'backfill' source the
	// table also accepts is inserted directly via batch SQL, never over oRPC.
	source: z.enum(['claude_sdk_result', 'codelayer_run', 'fold_run']),
	/** Event time, epoch ms (daemon clock). */
	occurredAt: z.number().int().positive(),
	entries: z
		.array(
			z.object({
				model: z.string().min(1).max(256),
				/** Raw open token map, Anthropic semantics (input excludes cache read/creation). */
				tokens: z.record(z.string(), z.number().int().nonnegative()),
				costUsd: z.number().nonnegative().optional(),
			}),
		)
		.min(1)
		.max(32),
})

// No transactionId: the table is not Electric-synced, nothing consumes a txid.
export const RecordSessionUsageOutputSchema = z.object({
	/** Rows actually inserted (0 on full idempotent replay). */
	recorded: z.number().int(),
})

export const recordSessionUsageContract = contractBuilder
	.input(RecordSessionUsageInputSchema)
	.output(RecordSessionUsageOutputSchema)
