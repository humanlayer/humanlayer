import { Context } from 'effect'

import type { BillingCheckoutCompletionServiceShape } from './billing-checkout-completion.types'

export class BillingCheckoutCompletionService extends Context.Service<
	BillingCheckoutCompletionService,
	BillingCheckoutCompletionServiceShape
>()('BillingCheckoutCompletionService') {}
