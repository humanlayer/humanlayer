import type { BillingKvCacheDecodeError, BillingKvUnavailableError } from '@humanlayer/billing/billing-kv'
import { Cause, Data, Option, Predicate } from 'effect'

import type {
	StripeBillingSyncError,
	StripeOperationError,
	StripeServiceInputParseError,
} from '../stripe/stripe.errors'

export type Dependency = 'kv_org_customer' | 'kv_subscription_cache' | 'stripe_refresh'

/** A cause with no failure in it: a thrown defect, or an interrupt. */
export class BillingStepDefect extends Data.TaggedError('BillingStepDefect')<{ readonly defect: unknown }> {}

export type BillingStepCause =
	| BillingKvUnavailableError
	| BillingKvCacheDecodeError
	| StripeBillingSyncError
	| StripeOperationError
	| StripeServiceInputParseError
	| Cause.TimeoutError

export class BillingStepFailure extends Data.TaggedError('BillingStepFailure')<{
	readonly step: Dependency
	readonly error: BillingStepCause | BillingStepDefect
}> {}

const STEP_CAUSE_TAGS = [
	'BillingKvUnavailableError',
	'BillingKvCacheDecodeError',
	'StripeBillingSyncError',
	'StripeOperationError',
	'StripeServiceInputParseError',
	'TimeoutError',
] as const

export const isBillingStepCause = (value: unknown): value is BillingStepCause =>
	STEP_CAUSE_TAGS.some((tag) => Predicate.isTagged(value, tag))

// A thrown error carries no failure in its cause, so a defect that is one of these is read as the
// error it holds. An interrupt, and anything else thrown, stays a defect.
export const classifyStepCause = <E extends BillingStepCause>(
	cause: Cause.Cause<E | Cause.TimeoutError>,
): BillingStepCause | BillingStepDefect => {
	const failure = Cause.findErrorOption(cause)
	if (Option.isSome(failure)) return failure.value

	const defect = Cause.squash(cause)
	return isBillingStepCause(defect) ? defect : new BillingStepDefect({ defect })
}

export const isCacheDecodeFailure = (failure: BillingStepFailure): boolean =>
	Predicate.isTagged(failure.error, 'BillingKvCacheDecodeError')
