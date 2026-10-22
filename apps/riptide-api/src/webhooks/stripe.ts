import { Effect } from 'effect'
import type { Hono } from 'hono'

import type { AppRuntime } from '../effects/app-runtime'
import { StripeService } from '../effects/services/stripe/stripe.service'
import { Sentry } from '../instrument'
import { logger } from '../logger'

const processStripeWebhook = (input: { readonly body: string; readonly signature: string }) =>
	Effect.gen(function* () {
		const stripe = yield* StripeService
		return yield* stripe.processWebhook(input)
	})

export function registerStripeWebhookRoute(app: Hono, deps: { readonly appRuntime: AppRuntime }): void {
	app.post('/webhooks/stripe', async (c) => {
		const requestId = c.req.header('x-request-id') ?? c.req.header('x-correlation-id')
		const signature = c.req.header('stripe-signature')
		if (!signature) {
			logger.warn({ requestId }, 'Missing Stripe-Signature header on Stripe webhook request')
			return c.json({ error: 'Missing Stripe-Signature header' }, 400)
		}

		let body: string
		try {
			body = await c.req.raw.text()
		} catch (error) {
			logger.warn({ error, requestId }, 'Unable to read Stripe webhook payload')
			return c.json({ error: 'Invalid Stripe webhook payload' }, 400)
		}

		try {
			const result = await deps.appRuntime.runPromise(processStripeWebhook({ body, signature }))
			return c.json(result)
		} catch (error) {
			if (isTaggedError(error, 'StripeWebhookSignatureError')) {
				logger.warn({ error, requestId }, 'Stripe webhook signature verification failed')
				return c.json({ error: 'Invalid Stripe webhook signature' }, 400)
			}
			if (isTaggedError(error, 'StripeWebhookPayloadError')) {
				logger.warn({ error, requestId }, 'Stripe webhook payload validation failed')
				return c.json({ error: 'Invalid Stripe webhook payload' }, 400)
			}

			logger.error({ error, requestId }, 'Stripe webhook processing failed')
			Sentry.captureException(error, {
				tags: { error_type: 'stripe_webhook_processing_failure' },
				extra: { requestId },
			})
			return c.json({ error: 'Stripe webhook processing failed' }, 500)
		}
	})
}

function isTaggedError(error: unknown, tag: string): boolean {
	return typeof error === 'object' && error !== null && '_tag' in error && error._tag === tag
}
