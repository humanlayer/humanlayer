import { Effect } from 'effect'
import type { Hono } from 'hono'

import { appRuntime } from '../effects/app-runtime'
import { BillingCheckoutCompletionService } from '../effects/services/billing-checkout-completion/billing-checkout-completion.service'

export function registerBillingCheckoutCompletionRoutes(app: Hono): void {
	app.get('/billing/checkout/finalize-starter-to-pro-upgrade', async (c) => {
		const result = await appRuntime.runPromise(
			Effect.gen(function* () {
				const service = yield* BillingCheckoutCompletionService
				return yield* service.finalizeStarterToProUpgradeFromRedirect({ url: c.req.url })
			}),
		)
		return c.redirect(result.redirectUrl)
	})

	app.get('/billing/checkout/resync', async (c) => {
		const result = await appRuntime.runPromise(
			Effect.gen(function* () {
				const service = yield* BillingCheckoutCompletionService
				return yield* service.resyncFromCheckoutRedirect({ url: c.req.url })
			}),
		)
		return c.redirect(result.redirectUrl)
	})
}
