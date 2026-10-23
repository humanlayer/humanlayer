import { userSettings } from '@humanlayer/db/tables/user-settings'
import { MembershipStatusSchema, type MembershipStatus } from '@humanlayer/riptide-api-contract/types/billing'
import type { OrganizationMembership, User } from '@workos-inc/node'
import { eq } from 'drizzle-orm'
import pLimit from 'p-limit'

import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

type ListedOrganizationMembership = OrganizationMembership & { status: MembershipStatus }

const isListedOrganizationMembership = (
	membership: OrganizationMembership,
): membership is ListedOrganizationMembership => MembershipStatusSchema.safeParse(membership.status).success

export const listAdminUsersProcedure = apiBaseForOrganizationAdmin.auth.admin.users.list.handler(
	async ({ context }) => {
		const {
			auth,
			services: { db, workos },
		} = context

		const [usersResult, membershipsResult, settingsRows] = await Promise.all([
			workos.userManagement.listUsers({ organizationId: auth.workosOrganizationId }),
			workos.userManagement.listOrganizationMemberships({
				organizationId: auth.workosOrganizationId,
				statuses: ['active', 'inactive'],
			}),
			db
				.select({
					user_id: userSettings.user_id,
					metrics_advanced_enabled: userSettings.metrics_advanced_enabled,
				})
				.from(userSettings)
				.where(eq(userSettings.organization_id, auth.organizationId)),
		])

		const metricsAdvancedByUserId = new Map(settingsRows.map((row) => [row.user_id, row.metrics_advanced_enabled]))

		const allUsers = await usersResult.autoPagination()
		const allMemberships = await membershipsResult.autoPagination()
		const listedMemberships = allMemberships.filter(isListedOrganizationMembership)
		if (listedMemberships.length !== allMemberships.length) {
			logger.warn(
				{
					workosOrganizationId: auth.workosOrganizationId,
					unexpectedMembershipCount: allMemberships.length - listedMemberships.length,
				},
				'WorkOS returned memberships outside the requested active and inactive statuses',
			)
		}

		const userMap = new Map<string, User>()
		for (const user of allUsers) userMap.set(user.id, user)

		const limitGetUser = pLimit(5)
		const usersByMembership = await Promise.all(
			listedMemberships.map(async (membership) => {
				const user =
					userMap.get(membership.userId) ??
					(await limitGetUser(() => workos.userManagement.getUser(membership.userId)))
				return { user, membership }
			}),
		)

		return {
			users: usersByMembership.map(({ user, membership }) => {
				return {
					id: user.id,
					email: user.email,
					firstName: user.firstName ?? undefined,
					lastName: user.lastName ?? undefined,
					profilePictureUrl: user.profilePictureUrl ?? undefined,
					role: membership.role.slug,
					membershipId: membership.id,
					status: membership.status,
					createdAt: user.createdAt,
					// No settings row => the member has never written settings, and the column
					// defaults TRUE, so they collect. Defaulting the panel to false here would
					// show a switch that contradicts the collector for exactly those members.
					metricsAdvancedEnabled: metricsAdvancedByUserId.get(user.id) ?? true,
				}
			}),
		}
	},
)
