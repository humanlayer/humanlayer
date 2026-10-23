import { Context } from 'effect'

import type { StripeServiceShape } from './stripe.types'

export class StripeService extends Context.Service<StripeService, StripeServiceShape>()('StripeService') {}
