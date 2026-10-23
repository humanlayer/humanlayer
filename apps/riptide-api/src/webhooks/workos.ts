import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Hono } from 'hono'

import { Sentry } from '../instrument'
import { syncOrganizationSeatQuantity } from '../lib/seat-sync'
import type { IStripeService } from '../lib/stripe-service'
import type { WorkosSdkAdapter } from '../lib/workos-service'
import { logger } from '../logger'

type WorkosWebhookDeps = {
	workosService: WorkosSdkAdapter
	stripeService: IStripeService
	db: PostgresJsDatabase
	/**
	 * Backfill `access_requests.requester_user_id` for anonymous requests matching an
	 * email. This webhook is not an oRPC procedure, so it can't bind to `appRuntime` the
	 * way Effect procedures do; instead callers supply an app-runtime-backed facade that
	 * runs `AccessRequestService.backfillRequesterUserId` through a `ManagedRuntime`
	 * (production: the module-level `appRuntime` built with the live db; tests: a runtime
	 * built with the injected test db). Best-effort — implementations resolve even on
	 * failure, and this webhook additionally wraps the call in its own try/catch.
	 */
	backfillAccessRequestRequesterUserId: (input: { email: string; userId: string }) => Promise<void>
}

export function registerWorkosWebhookRoute(app: Hono, deps: WorkosWebhookDeps): void {
	app.post('/webhooks/workos', async (c) => {
		const signature = c.req.header('workos-signature')
		if (!signature) {
			logger.warn('Missing WorkOS-Signature header on WorkOS webhook request')
			return c.json({ error: 'Missing WorkOS-Signature header' }, 400)
		}

		const body = await c.req.raw.text()

		let event: Awaited<ReturnType<WorkosSdkAdapter['verifyWebhook']>>
		try {
			event = await deps.workosService.verifyWebhook(body, signature)
		} catch (error) {
			logger.error(error, 'WorkOS webhook signature verification failed')
			Sentry.captureException(error, {
				tags: {
					component: 'workos_webhook',
					failure_type: 'signature_verification',
				},
			})
			return c.json({ error: 'Invalid WorkOS webhook signature' }, 400)
		}

		logger.info(
			{
				eventId: event.id,
				eventType: event.event,
			},
			'Received WorkOS webhook event',
		)

		const membershipEvent = deps.workosService.getMembershipWebhookEvent(event)
		if (!membershipEvent) {
			logger.info({ eventId: event.id, eventType: event.event }, 'Ignoring non-membership WorkOS webhook event')
			return c.json({ received: true, ignored: true })
		}

		try {
			logger.info(
				{
					eventId: event.id,
					eventType: event.event,
					workosOrganizationId: membershipEvent.workosOrganizationId,
				},
				'Processing WorkOS membership webhook event',
			)

			const [organization] = await deps.db
				.select({ id: organizations.id })
				.from(organizations)
				.where(eq(organizations.workos_organization_id, membershipEvent.workosOrganizationId))
				.limit(1)

			if (!organization) {
				throw new Error(
					`No local organization found for WorkOS organization ${membershipEvent.workosOrganizationId}`,
				)
			}

			const result = await syncOrganizationSeatQuantity(
				{ organizationId: organization.id, reason: 'workos_webhook' },
				{ workosService: deps.workosService, stripeService: deps.stripeService, db: deps.db },
			)

			// Backfill requester_user_id for anonymous access requests when a user joins
			if (membershipEvent.eventType === 'organization_membership.created') {
				try {
					const user = await deps.workosService.userManagement.getUser(membershipEvent.userId)
					await deps.backfillAccessRequestRequesterUserId({
						email: user.email,
						userId: membershipEvent.userId,
					})
				} catch (e) {
					logger.error({ error: e }, 'Failed to backfill access_requests.requester_user_id')
					Sentry.captureException(e, {
						tags: {
							component: 'workos_webhook',
							failure_type: 'access_request_backfill',
						},
					})
				}
			}

			logger.info(
				{
					eventId: event.id,
					eventType: event.event,
					workosOrganizationId: membershipEvent.workosOrganizationId,
					organizationId: organization.id,
					seatSync: result,
				},
				'Processed WorkOS membership webhook event',
			)

			return c.json({ received: true, seatSync: result })
		} catch (error) {
			logger.error(
				error,
				{
					eventId: event.id,
					eventType: event.event,
					workosOrganizationId: membershipEvent.workosOrganizationId,
				},
				'WorkOS webhook processing failed',
			)
			Sentry.captureException(error, {
				tags: {
					component: 'workos_webhook',
					failure_type: 'processing',
					event_type: event.event,
				},
				extra: {
					eventId: event.id,
					eventType: event.event,
					workosOrganizationId: membershipEvent.workosOrganizationId,
				},
			})
			return c.json({ error: 'WorkOS webhook processing failed' }, 500)
		}
	})
}
