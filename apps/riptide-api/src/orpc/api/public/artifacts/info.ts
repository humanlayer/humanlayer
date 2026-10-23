import { type AccessRequestStatus, accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import * as Sentry from '@sentry/node'
import { and, eq, or } from 'drizzle-orm'

import logger from '../../../../logger'
import { apiBasePublic } from '../../../base'

export const artifactInfoProcedure = apiBasePublic.public.artifacts.info.handler(async ({ context, input, errors }) => {
	const { db, workos } = context.services
	const [row] = await db
		.select({
			id: artifacts.id,
			organization_id: artifacts.organization_id,
			file_name: artifacts.file_name,
			workos_organization_id: organizations.workos_organization_id,
			organization_name: organizations.name,
		})
		.from(artifacts)
		.leftJoin(organizations, eq(organizations.id, artifacts.organization_id))
		.where(eq(artifacts.id, input.artifactId))
		.limit(1)

	if (!row) throw errors.NOT_FOUND()

	if (context.auth?.organizationId === row.organization_id) {
		return { exists: true, accessible: true }
	}

	// User is logged in but the artifact belongs to a different org than their currently
	// active org. Check whether the user is a member of the artifact's org via WorkOS so
	// we can prompt them to switch instead of treating them as a non-member.
	if (context.auth?.userId && row.workos_organization_id && row.organization_name) {
		try {
			const memberships = await workos.userManagement.listOrganizationMemberships({
				userId: context.auth.userId,
				organizationId: row.workos_organization_id,
				statuses: ['active'],
				limit: 1,
			})
			// We only need to know whether an active membership exists, so read the
			// first page directly rather than paginating through every membership.
			if (memberships.data.length > 0) {
				return {
					exists: true,
					accessible: true,
					requiresOrgSwitch: true,
					workosOrganizationId: row.workos_organization_id,
					organizationName: row.organization_name,
				}
			}
		} catch (error) {
			// Best-effort: fall through to access-request flow on WorkOS errors.
			logger.error(
				{ err: error, userId: context.auth.userId, workosOrganizationId: row.workos_organization_id },
				'WorkOS membership lookup failed in artifact info handler',
			)
			Sentry.captureException(error, {
				tags: { error_type: 'workos_membership_lookup' },
				extra: { userId: context.auth.userId, workosOrganizationId: row.workos_organization_id },
			})
		}
	}

	const [settings] = await db
		.select({ enabled: organizationSettings.access_requests_enabled })
		.from(organizationSettings)
		.where(eq(organizationSettings.organization_id, row.organization_id))
		.limit(1)

	if (settings?.enabled === false) throw errors.NOT_FOUND()

	if (!row.organization_name) throw errors.NOT_FOUND()

	let myRequestStatus: AccessRequestStatus | 'none' = 'none'
	let lastRequestedAt: string | null = null

	const requesterUserId = context.auth?.userId
	// email isn't on the access token, so resolve it from WorkOS to also match requests
	// created (while logged out) under the same email. Best-effort: fall back to
	// user-id matching if the lookup fails.
	let requesterEmail: string | undefined
	if (requesterUserId) {
		try {
			const user = await workos.userManagement.getUser(requesterUserId)
			requesterEmail = user.email.trim().toLowerCase()
		} catch (error) {
			logger.error(
				{ err: error, userId: requesterUserId },
				'WorkOS user lookup failed while resolving access-request status',
			)
			Sentry.captureException(error, { tags: { error_type: 'workos_user_lookup' } })
		}
	}
	if (requesterEmail || requesterUserId) {
		const identityConditions = []
		if (requesterEmail) identityConditions.push(eq(accessRequests.requester_email, requesterEmail))
		if (requesterUserId) identityConditions.push(eq(accessRequests.requester_user_id, requesterUserId))

		const identityCondition = identityConditions.length === 1 ? identityConditions[0] : or(...identityConditions)
		if (identityCondition) {
			const [request] = await db
				.select({ status: accessRequests.status, requested_at: accessRequests.requested_at })
				.from(accessRequests)
				.where(and(eq(accessRequests.artifact_id, input.artifactId), identityCondition))
				.limit(1)

			if (request) {
				myRequestStatus = request.status
				lastRequestedAt = request.requested_at.toISOString()
			}
		}
	}

	// If an admin has already invited this requester (pending invitation on the
	// WorkOS Invitations table), surface the "check your email" state regardless of
	// the access_requests row. This prevents re-requesting (and re-notifying admins)
	// when an invite is already outstanding. Best-effort: ignore WorkOS errors.
	if (requesterEmail && row.workos_organization_id) {
		try {
			const invitationsResult = await workos.userManagement.listInvitations({
				organizationId: row.workos_organization_id,
				email: requesterEmail,
			})
			const invitations = await invitationsResult.autoPagination()
			if (invitations.some((invitation) => invitation.state === 'pending')) {
				myRequestStatus = 'invited'
			}
		} catch (error) {
			logger.error(
				{ err: error, workosOrganizationId: row.workos_organization_id },
				'WorkOS invitation lookup failed while resolving access-request status',
			)
			Sentry.captureException(error, { tags: { error_type: 'workos_invitation_lookup' } })
		}
	}

	// Best-effort org branding: surface the primary verified domain so the access
	// screens can render the org's logo (logo.dev) with a Building2 fallback. On any
	// WorkOS error or absence of a verified domain, `domain` is null and the UI falls
	// back to the icon — no failure surfaced to the user.
	let domain: string | null = null
	if (row.workos_organization_id) {
		try {
			const organization = await workos.organizations.getOrganization(row.workos_organization_id)
			domain = organization.domains.find((d) => d.state === 'verified')?.domain ?? null
		} catch (error) {
			logger.error(
				{ err: error, workosOrganizationId: row.workos_organization_id },
				'WorkOS organization lookup failed while resolving org domain for branding',
			)
			Sentry.captureException(error, { tags: { error_type: 'workos_organization_lookup' } })
		}
	}

	return {
		exists: true,
		accessible: false,
		organizationName: row.organization_name,
		domain,
		myRequestStatus,
		lastRequestedAt,
	}
})
