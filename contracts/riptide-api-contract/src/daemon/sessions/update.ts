import { SessionErrorReasonSchema } from '@humanlayer/schemas/zod/session/session-error-reason'
import { SessionStatusSchema } from '@humanlayer/schemas/zod/session/session-status'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

const TokenCountSchema = z.number().int().nonnegative()

export const ModelTokenUsageSchema = z.object({
	input_tokens: TokenCountSchema,
	output_tokens: TokenCountSchema,
	cache_read_input_tokens: TokenCountSchema.optional(),
	cache_creation_input_tokens: TokenCountSchema.optional(),
})

export const SessionModelUsageSchema = z.record(z.string(), ModelTokenUsageSchema)

export const UpdateSessionInputSchema = z.object({
	sessionId: z.uuid(),

	// Optional fields that can be updated
	codingAgentSessionId: z.string().optional(),
	// `lost` is derived by the API from missed heartbeats; a daemon never reports it.
	status: SessionStatusSchema.exclude(['lost']).optional(),
	model: z.string().optional(),
	resolvedModel: z.string().optional(),
	errorMessage: z.string().optional(),
	/** Typed failure classification; the UI switches on this instead of parsing errorMessage. Null clears it. */
	errorReason: SessionErrorReasonSchema.nullable().optional(),
	contextWindowTokens: z.number().int().optional(),
	contextWindowLimit: z.number().int().optional(),
	isCompacting: z.boolean().optional(),
	totalCostUsd: z.number().optional(),
	modelUsage: SessionModelUsageSchema.optional(),
	/**
	 * Idempotency key for the usage report carried by totalCostUsd/modelUsage.
	 *
	 * Each coding-agent run reports per-run usage totals (the SDK's cumulative counters reset when
	 * a session is resumed with a fresh query), so the API accumulates them into the session totals.
	 * The daemon's oRPC client retries failed calls with an identical payload; this key lets the API
	 * skip re-applying a usage report it has already merged. When omitted, the API falls back to the
	 * legacy overwrite behavior.
	 */
	usageReportKey: z.string().optional(),
})

export const UpdateSessionOutputSchema = z.object({
	success: z.boolean(),
	transactionId: z.string(),
})

export const updateSessionContract = contractBuilder.input(UpdateSessionInputSchema).output(UpdateSessionOutputSchema)
