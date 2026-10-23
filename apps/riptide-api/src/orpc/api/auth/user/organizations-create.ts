import { organizations } from '@humanlayer/db/tables/organizations'
import * as Sentry from '@sentry/node'
import { DomainDataState, type Organization } from '@workos-inc/node'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { refreshStripeBillingCache } from '../../../../effects/services/billing/billing-access.service'
import { OnboardingService } from '../../../../effects/services/onboarding/onboarding.service'
import {
	BLOCK_NEW_ORG_CREATION_MESSAGE,
	isDevEnvironment,
	isHumanlayerEmailDomain,
	isHumanlayerStaffEmail,
	isNewOrgCreationBlocked,
} from '../../../../lib/environment'
import { getStarterFreeCapacityRemaining } from '../../../../lib/free-capacity'
import { logger } from '../../../../logger'
import { apiBaseNoOrg } from '../../../base'

type ProvisioningStepResult = {
	customerId: string
	createdCustomer: boolean
	subscriptionId: string
	createdSubscription: boolean
}

export const createOrganizationProcedure = apiBaseNoOrg.auth.user.organizations.create.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { workos, db, stripe },
		} = context

		if (isNewOrgCreationBlocked()) {
			// HumanLayer staff (humanlayer.dev / humanlayer.com) can still create
			// orgs even on environments where new org creation is blocked.
			const user = await workos.userManagement.getUser(auth.userId)
			if (!isHumanlayerStaffEmail(user.email)) {
				throw errors.BAD_REQUEST({
					data: { message: BLOCK_NEW_ORG_CREATION_MESSAGE },
				})
			}
		}

		if (isDevEnvironment()) {
			const user = await workos.userManagement.getUser(auth.userId)
			if (!isHumanlayerEmailDomain(user.email)) {
				throw errors.FORBIDDEN({
					data: {
						message:
							'Organization creation is restricted to humanlayer.dev email domains in dev environments',
					},
				})
			}
		}

		const CONSUMER_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']
		const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/
		if (input.domains && input.domains.length > 0) {
			if (input.domains.length > 5) {
				throw errors.BAD_REQUEST({ data: { message: 'Maximum 5 domains allowed' } })
			}
			for (const domain of input.domains) {
				if (!HOSTNAME_REGEX.test(domain)) {
					throw errors.BAD_REQUEST({ data: { message: `Invalid domain: ${domain}` } })
				}
				if (CONSUMER_DOMAINS.includes(domain.toLowerCase())) {
					throw errors.BAD_REQUEST({ data: { message: `Consumer domain not allowed: ${domain}` } })
				}
			}
		}

		let workosOrg: Organization
		try {
			workosOrg = await workos.organizations.createOrganization({
				name: input.name,
				domainData:
					input.domains?.map((domain) => ({
						domain,
						state: DomainDataState.Pending,
					})) ?? [],
			})
		} catch (error) {
			logger.error({ err: error }, 'Failed to create organization in WorkOS')
			throw errors.INTERNAL_SERVER_ERROR()
		}

		let dbOrg: typeof organizations.$inferSelect
		try {
			const [inserted] = await db
				.insert(organizations)
				.values({
					name: input.name,
					workos_organization_id: workosOrg.id,
					eula_accepted_by: auth.userId,
					eula_accepted_at: Date.now(),
				})
				.returning()

			if (!inserted) {
				throw new Error('No organization returned from insert')
			}

			dbOrg = inserted
		} catch (error) {
			const e = error as Error
			logger.error(
				{ message: e.message, stack: e.stack, name: e.name },
				'Failed to create organization in database',
			)
			throw errors.INTERNAL_SERVER_ERROR()
		}

		let provisioning: ProvisioningStepResult
		let provisionedCustomerId: string | null = null
		let createdStripeCustomer = false
		try {
			const user = await workos.userManagement.getUser(auth.userId)
			const customer = await stripe.ensureStripeCustomerForOrg({
				organizationId: dbOrg.id,
				organizationName: dbOrg.name,
				adminEmail: user.email,
				existingCustomerId: dbOrg.stripe_customer_id,
			})

			provisionedCustomerId = customer.customerId
			createdStripeCustomer = customer.created

			const [updatedOrg] = await db
				.update(organizations)
				.set({ stripe_customer_id: customer.customerId })
				.where(eq(organizations.id, dbOrg.id))
				.returning()

			if (!updatedOrg) {
				throw new Error('Failed to persist Stripe customer id on organization')
			}

			dbOrg = updatedOrg

			await stripe.ensureBillingOrgMappings({
				organizationId: dbOrg.id,
				customerId: customer.customerId,
			})

			await workos.organizations.updateOrganization({
				organization: workosOrg.id,
				stripeCustomerId: customer.customerId,
				metadata: {
					internal_org_id: dbOrg.id,
				},
			})

			const quantity = await workos.countActiveOrganizationMemberships(workosOrg.id)

			const subscription = await stripe.ensureStarterSubscription({
				customerId: customer.customerId,
				quantity,
			})
			await context.services.effectRuntime.runPromise(refreshStripeBillingCache(customer.customerId))

			provisioning = {
				customerId: customer.customerId,
				createdCustomer: customer.created,
				subscriptionId: subscription.subscriptionId,
				createdSubscription: subscription.created,
			}
		} catch (error) {
			logger.error(
				{
					err: error,
					organizationId: dbOrg.id,
					workosOrganizationId: workosOrg.id,
					stripeCustomerId: provisionedCustomerId,
				},
				'Organization billing provisioning failed; starting compensation cleanup',
			)

			if (provisionedCustomerId) {
				try {
					await db
						.update(organizations)
						.set({ stripe_customer_id: null })
						.where(
							and(
								eq(organizations.id, dbOrg.id),
								eq(organizations.stripe_customer_id, provisionedCustomerId),
							),
						)
				} catch (cleanupError) {
					logger.error(
						{ err: cleanupError, organizationId: dbOrg.id },
						'Failed to clear stripe_customer_id during compensation cleanup',
					)
					Sentry.captureException(cleanupError, {
						tags: {
							error_type: 'organization_provisioning_cleanup',
							operation: 'clear_stripe_customer_id',
						},
						extra: { organizationId: dbOrg.id, workosOrganizationId: workosOrg.id },
					})
				}
			}

			try {
				await db.delete(organizations).where(eq(organizations.id, dbOrg.id))
			} catch (cleanupError) {
				logger.error(
					{ err: cleanupError, organizationId: dbOrg.id },
					'Failed to roll back local organization during compensation cleanup',
				)
				Sentry.captureException(cleanupError, {
					tags: { error_type: 'organization_provisioning_cleanup', operation: 'rollback_local_organization' },
					extra: { organizationId: dbOrg.id, workosOrganizationId: workosOrg.id },
				})
			}

			if (createdStripeCustomer && provisionedCustomerId) {
				try {
					await stripe.deleteCustomer(provisionedCustomerId)
				} catch (cleanupError) {
					logger.error(
						{ err: cleanupError, customerId: provisionedCustomerId },
						'Failed to delete newly created Stripe customer during compensation cleanup',
					)
					Sentry.captureException(cleanupError, {
						tags: { error_type: 'organization_provisioning_cleanup', operation: 'delete_stripe_customer' },
						extra: { organizationId: dbOrg.id, customerId: provisionedCustomerId },
					})
				}
			}

			throw errors.INTERNAL_SERVER_ERROR({
				data: { message: 'Failed to provision billing for organization creation' },
			})
		}

		try {
			await workos.userManagement.createOrganizationMembership({
				userId: auth.userId,
				organizationId: workosOrg.id,
				roleSlug: 'admin',
			})
		} catch (error) {
			logger.error({ err: error }, 'Failed to create organization membership')
			throw errors.INTERNAL_SERVER_ERROR()
		}

		const failedInvites: string[] = []
		if (input.inviteEmails && input.inviteEmails.length > 0) {
			const activeMembers = await workos.countActiveOrganizationMemberships(workosOrg.id)
			const pendingInvitations = await workos.countPendingInvitations({ workosOrganizationId: workosOrg.id })
			const remainingInviteCapacity = getStarterFreeCapacityRemaining({ activeMembers, pendingInvitations })
			const emailsToInvite = input.inviteEmails.slice(0, remainingInviteCapacity)
			failedInvites.push(...input.inviteEmails.slice(remainingInviteCapacity))

			const results = await Promise.allSettled(
				emailsToInvite.map((email) =>
					workos.userManagement.sendInvitation({
						email,
						organizationId: workosOrg.id,
						inviterUserId: auth.userId,
						roleSlug: 'member',
						expiresInDays: 7,
					}),
				),
			)

			results.forEach((result, index) => {
				const email = emailsToInvite[index]
				if (result.status === 'rejected' && email) {
					failedInvites.push(email)
					Sentry.captureException(result.reason, {
						extra: { email, orgId: workosOrg.id },
					})
				}
			})
		}

		logger.info(
			{
				organizationId: dbOrg.id,
				stripeCustomerId: provisioning.customerId,
				stripeSubscriptionId: provisioning.subscriptionId,
				createdStripeCustomer: provisioning.createdCustomer,
				createdStripeSubscription: provisioning.createdSubscription,
			},
			'Created organization with Stripe Starter billing provisioning',
		)

		// Fire-and-forget onboarding enrollment on the shared app Effect runtime.
		// `runFork` returns synchronously with a background root fiber, so organization
		// creation never blocks on Resend/WorkOS. Failures are captured to Sentry and
		// swallowed so they can't surface to the caller.
		const enrollmentInput = { userId: auth.userId, organizationId: dbOrg.id }
		context.services.effectRuntime.runFork(
			Effect.gen(function* () {
				const onboarding = yield* OnboardingService
				yield* onboarding.enrollMember(enrollmentInput)
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						yield* Effect.logError('Detached onboarding enrollment failed').pipe(
							Effect.annotateLogs(enrollmentInput),
						)
						yield* Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'onboarding_detached_failure' },
								extra: enrollmentInput,
							}),
						)
					}),
				),
			),
		)

		return {
			organizationId: dbOrg.id,
			workosOrganizationId: workosOrg.id,
			organizationName: workosOrg.name,
			stripeCustomerId: provisioning.customerId,
			failedInvites,
		}
	},
)
