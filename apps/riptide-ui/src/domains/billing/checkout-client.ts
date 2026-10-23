import type { BillingCheckoutClient } from '@humanlayer/riptide-api-contract/types/billing'

import { isTauri } from '@/lib/utils'

export function getBillingCheckoutClient(): BillingCheckoutClient {
	return isTauri() ? 'native' : 'ui'
}
