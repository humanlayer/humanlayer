import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { Effect, Result } from 'effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AccessRequestService } from '../../../../effects/services/access-request/access-request.service'
import type { WorkosError } from '../../../../effects/services/workos/workos.errors'
import { WorkosService } from '../../../../effects/services/workos/workos.service'
import { Sentry } from '../../../../instrument'
import { buildUpgradeRequiredData, wouldExceedStarterCapacity } from '../../../../lib/free-capacity'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

function normalizePriceId(value: string | null | undefined): string | null {
	const normalized = value?.trim()
	return normalized ? normalized : null
}

/**
 * Read the underlying error message + code out of a classified `WorkosError`. WorkOS
 * surfaces "already a member" / "already invited" outcomes as ordinary (sub-500) client
 * errors, so the live `WorkosService` classifies them as `WorkosClientError` while
 * preserving the original SDK error in `cause`. The invitation branching below inspects
 * that preserved cause to reproduce the classic handler's exact response/error behavior.
 */
const WorkosErrorEnvelope = Schema.Struct({ cause: Schema.optionalKey(Schema.Unknown) })
const WorkosErrorCause = Schema.Struct({
	message: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(Schema.String),
})

function workosErrorDetails(error: WorkosError): { message: string; code: string | undefined } {
	const envelope = Option.getOrUndefined(Schema.decodeUnknownOption(WorkosErrorEnvelope)(error))
	const cause = Option.getOrUndefined(Schema.decodeUnknownOption(WorkosErrorCause)(envelope?.cause))
	return { message: cause?.message?.toLowerCase() ?? '', code: cause?.code }
}

export const createAdminInvitationProcedure = effectOrpcBaseForOrganizationAdmin.auth.admin.invitations.create.effect(
	function* ({ context, input, errors }) {
		const workos = yield* WorkosService
		const accessRequests = yield* AccessRequestService
		const { auth } = context
		const billingKv = yield* BillingKvService

		yield* Effect.annotateCurrentSpan({
			email: input.email,
			organization_id: auth.organizationId,
			workos_organization_id: auth.workosOrganizationId,
			acting_admin_user_id: auth.userId,
		})

		const customerId = yield* billingKv
			.getOrgCustomerId({ organizationId: auth.organizationId })
			.pipe(Effect.mapError(() => errors.INTERNAL_SERVER_ERROR()))
		const cache = customerId
			? yield* billingKv
					.getSubscriptionCache({ customerId })
					.pipe(Effect.mapError(() => errors.INTERNAL_SERVER_ERROR()))
			: null
		const starterPriceId = normalizePriceId(process.env.STRIPE_PRICE_STARTER)
		const isStarter = Boolean(starterPriceId && cache?.priceId === starterPriceId)
		if (isStarter) {
			const capacityResult = yield* Effect.all([
				workos.countActiveOrganizationMemberships(auth.workosOrganizationId),
				workos.countPendingInvitations({ workosOrganizationId: auth.workosOrganizationId }),
			]).pipe(Effect.result)

			if (Result.isFailure(capacityResult)) {
				yield* Effect.logError('Failed to evaluate Starter invitation capacity', capacityResult.failure)
				yield* Effect.sync(() =>
					Sentry.captureException(capacityResult.failure, {
						tags: { error_type: 'starter_invitation_capacity_check' },
						extra: {
							email: input.email,
							organizationId: auth.organizationId,
							workosOrganizationId: auth.workosOrganizationId,
							actingAdminUserId: auth.userId,
						},
					}),
				)
				return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
			}

			const [activeMembers, pendingInvitations] = capacityResult.success

			if (wouldExceedStarterCapacity({ activeMembers, pendingInvitations, requestedInvitations: 1 })) {
				return yield* Effect.fail(
					errors.UPGRADE_REQUIRED({
						data: buildUpgradeRequiredData({ activeMembers, pendingInvitations }),
					}),
				)
			}
		}

		// Best-effort helper: resolve matching access requests + cancel reminders after an
		// invite action. Mirrors the classic handler -- resolution failures are logged and
		// captured but never fail the invitation response.
		const resolveAccessRequests = accessRequests
			.sendInviteAndResolveRequests({
				requesterEmail: input.email,
				organizationId: auth.organizationId,
				workosOrganizationId: auth.workosOrganizationId,
				actingAdminUserId: auth.userId,
				roleSlug: input.roleSlug,
				expiresInDays: input.expiresInDays,
			})
			.pipe(
				Effect.withSpan('access_requests.resolve_post_invite', {
					attributes: {
						email: input.email,
						organization_id: auth.organizationId,
						workos_organization_id: auth.workosOrganizationId,
						acting_admin_user_id: auth.userId,
					},
				}),
				Effect.catch((error) =>
					Effect.gen(function* () {
						yield* Effect.logError('Failed to resolve access requests post-invite', error)
						yield* Effect.sync(() => {
							Sentry.captureException(error, {
								tags: { error_type: 'resolve_access_requests_post_invite' },
								extra: {
									email: input.email,
									organizationId: auth.organizationId,
									actingAdminUserId: auth.userId,
								},
							})
						})
					}),
				),
			)

		const invitationResult = yield* workos
			.sendInvitation({
				email: input.email,
				organizationId: auth.workosOrganizationId,
				inviterUserId: auth.userId,
				roleSlug: input.roleSlug,
				expiresInDays: input.expiresInDays,
			})
			.pipe(
				Effect.withSpan('workos.send_invitation', {
					attributes: {
						email: input.email,
						workos_organization_id: auth.workosOrganizationId,
						acting_admin_user_id: auth.userId,
					},
				}),
				Effect.result,
			)

		if (Result.isSuccess(invitationResult)) {
			const invitation = invitationResult.success
			// Best-effort: resolve matching access requests and cancel reminders.
			yield* resolveAccessRequests
			yield* Effect.logInfo('Admin invitation created').pipe(
				Effect.annotateLogs({
					email: input.email,
					organizationId: auth.organizationId,
					workosOrganizationId: auth.workosOrganizationId,
					actingAdminUserId: auth.userId,
					invitationId: invitation.id,
				}),
			)

			return {
				invitation: {
					id: invitation.id,
					email: invitation.email,
					state: invitation.state,
				},
			}
		}

		const error = invitationResult.failure
		const { message, code } = workosErrorDetails(error)

		// WorkOS returns GenericServerException with message "User already a member of organization."
		if (code === 'entity_already_exists' || message.includes('already a member')) {
			// Already a member: still resolve any stale pending requests.
			yield* resolveAccessRequests
			yield* Effect.logInfo('Admin invitation skipped because user is already a member').pipe(
				Effect.annotateLogs({
					email: input.email,
					organizationId: auth.organizationId,
					workosOrganizationId: auth.workosOrganizationId,
					actingAdminUserId: auth.userId,
				}),
			)
			return yield* Effect.fail(
				errors.ALREADY_A_MEMBER({
					data: { message: 'This user is already a member of the organization' },
				}),
			)
		}

		// WorkOS returns GenericServerException with message "Email already invited to organization."
		if (message.includes('already invited')) {
			// Treat as effective invite success for access-request resolution.
			yield* resolveAccessRequests
			yield* Effect.logInfo('Admin invitation skipped because email is already invited').pipe(
				Effect.annotateLogs({
					email: input.email,
					organizationId: auth.organizationId,
					workosOrganizationId: auth.workosOrganizationId,
					actingAdminUserId: auth.userId,
				}),
			)
			return yield* Effect.fail(
				errors.ALREADY_INVITED({
					data: { message: 'An invitation has already been sent to this email address' },
				}),
			)
		}

		yield* Effect.logError('Failed to send invitation', error)
		yield* Effect.sync(() =>
			Sentry.captureException(error, {
				tags: { error_type: 'send_invitation' },
				extra: {
					email: input.email,
					organizationId: auth.organizationId,
					workosOrganizationId: auth.workosOrganizationId,
					actingAdminUserId: auth.userId,
				},
			}),
		)
		return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
	},
)
