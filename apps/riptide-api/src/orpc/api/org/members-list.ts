import type { OrganizationMembership, User } from '@workos-inc/node'

import { apiBaseOrgRequired } from '../../base'

export const listOrgMembersProcedure = apiBaseOrgRequired.organization.members.list.handler(async ({ context }) => {
	const {
		auth,
		services: { workos },
	} = context

	const usersResult = await workos.userManagement.listUsers({
		organizationId: auth.workosOrganizationId,
	})
	const allUsers = await usersResult.autoPagination()

	return {
		members: allUsers.map((user: User) => ({
			id: user.id,
			email: user.email,
			firstName: user.firstName ?? undefined,
			lastName: user.lastName ?? undefined,
			profilePictureUrl: user.profilePictureUrl ?? undefined,
		})),
	}
})

export const listActiveOrgMembersProcedure = apiBaseOrgRequired.organization.members.listActive.handler(
	async ({ context }) => {
		const {
			auth,
			services: { workos },
		} = context

		const [usersResult, membershipsResult] = await Promise.all([
			workos.userManagement.listUsers({
				organizationId: auth.workosOrganizationId,
			}),
			workos.userManagement.listOrganizationMemberships({
				organizationId: auth.workosOrganizationId,
				statuses: ['active'],
			}),
		])
		const [allUsers, activeMemberships] = await Promise.all([
			usersResult.autoPagination(),
			membershipsResult.autoPagination(),
		])
		const activeUserIds = new Set(activeMemberships.map((membership: OrganizationMembership) => membership.userId))

		return {
			members: allUsers
				.filter((user: User) => activeUserIds.has(user.id))
				.map((user: User) => ({
					id: user.id,
					email: user.email,
					firstName: user.firstName ?? undefined,
					lastName: user.lastName ?? undefined,
					profilePictureUrl: user.profilePictureUrl ?? undefined,
				})),
		}
	},
)
