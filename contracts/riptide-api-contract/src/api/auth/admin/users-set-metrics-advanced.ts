import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

/**
 * Per-user Advanced Metrics exclusion (`user_settings.metrics_advanced_enabled`). A member's
 * commits and PRs are collected when the org's collection flags AND this per-user flag are set,
 * and this flag defaults TRUE — so the org opt-in is the decision, and an admin uses this to
 * exclude an individual. Deliberately absent from the user-facing settings contract — only org
 * admins can flip it.
 */
export const SetAdminUserMetricsAdvancedInputSchema = z.object({
	userId: z.string(),
	enabled: z.boolean(),
})

export const SetAdminUserMetricsAdvancedOutputSchema = z.object({
	userId: z.string(),
	metricsAdvancedEnabled: z.boolean(),
})

export const setAdminUserMetricsAdvancedContract = contractBuilder
	.input(SetAdminUserMetricsAdvancedInputSchema)
	.output(SetAdminUserMetricsAdvancedOutputSchema)
	.errors({
		USER_NOT_FOUND: {
			status: StatusCodes.NOT_FOUND,
			data: z.object({ message: z.string() }),
		},
	})
