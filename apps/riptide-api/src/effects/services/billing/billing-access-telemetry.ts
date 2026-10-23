import * as Sentry from '@sentry/node'
import { Effect } from 'effect'

import type { BillingAccessInput } from './billing-access.service'

export const captureFailOpen = (input: BillingAccessInput, reason: string, error?: unknown): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.logWarning('Billing access failed open for billing-required operation').pipe(
			Effect.annotateLogs({ error, reason, operation: input.operation, organizationId: input.organizationId }),
		)
		yield* Effect.sync(() =>
			Sentry.captureMessage('Billing access failed open', {
				level: 'warning',
				tags: { error_type: 'billing_access_fail_open', reason, operation: input.operation },
				extra: { organizationId: input.organizationId },
			}),
		)
	})

export const captureBlocked = (
	input: BillingAccessInput,
	details: {
		reason: string
		customerId?: string | null
		subscriptionId?: string | null
		subscriptionStatus?: string | null
		error?: unknown
	},
): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.logInfo('Billing access blocked billing-required operation').pipe(
			Effect.annotateLogs({ ...details, operation: input.operation, organizationId: input.organizationId }),
		)
		yield* Effect.sync(() =>
			Sentry.addBreadcrumb({
				category: 'billing_access',
				message: `Blocked: ${details.reason}`,
				level: 'info',
				data: { operation: input.operation, organizationId: input.organizationId, reason: details.reason },
			}),
		)
	})

export const captureRefreshRequired = (
	input: BillingAccessInput,
	details: { reason: string; customerId: string },
): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* Effect.logError('Billing access subscription cache requires refresh before decision').pipe(
			Effect.annotateLogs({ ...details, operation: input.operation, organizationId: input.organizationId }),
		)
		yield* Effect.sync(() => {
			Sentry.addBreadcrumb({
				category: 'billing_access',
				message: `Refresh required: ${details.reason}`,
				level: 'error',
				data: { operation: input.operation, organizationId: input.organizationId, reason: details.reason },
			})
			Sentry.captureMessage('Billing access subscription cache requires refresh', {
				level: 'error',
				tags: {
					error_type: 'billing_access_refresh_required',
					reason: details.reason,
					operation: input.operation,
				},
				extra: { organizationId: input.organizationId, customerId: details.customerId },
			})
		})
	})
