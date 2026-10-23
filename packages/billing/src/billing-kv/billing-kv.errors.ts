import { Data } from 'effect'

import type { RedisServiceError } from '../redis/redis-service'

export type BillingKvOperation =
	| 'get_org_customer_id'
	| 'set_org_customer_id'
	| 'get_customer_org_id'
	| 'set_customer_org_id'
	| 'get_subscription_cache'
	| 'set_subscription_cache'

export class BillingKvUnavailableError extends Data.TaggedError('BillingKvUnavailableError')<{
	readonly operation: BillingKvOperation
	readonly cause: RedisServiceError
}> {}

export class BillingKvCacheDecodeError extends Data.TaggedError('BillingKvCacheDecodeError')<{
	readonly key: string
	readonly cause: unknown
}> {}

export class BillingKvCacheEncodeError extends Data.TaggedError('BillingKvCacheEncodeError')<{
	readonly cause: unknown
}> {}
