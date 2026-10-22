import { type OrgMember, useOrgMembers } from '@/hooks/useOrgMembers'

function getUserInitials(firstName?: string, lastName?: string, email?: string): string {
	if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase()
	if (firstName) return firstName.charAt(0).toUpperCase()
	if (email) return email.charAt(0).toUpperCase()
	return '?'
}

export function resolveTaskOwnerDisplay(resourceOwnerUserId: string, ownerMember?: OrgMember) {
	const ownerFullName = ownerMember
		? [ownerMember.firstName, ownerMember.lastName].filter(Boolean).join(' ') || ownerMember.email
		: resourceOwnerUserId.slice(0, 8)
	const ownerInitials = ownerMember
		? getUserInitials(ownerMember.firstName, ownerMember.lastName, ownerMember.email)
		: '?'

	return { ownerFullName, ownerInitials }
}

/** Resolve the task owner's display name/initials/avatar for task detail. */
export function useTaskOwnerDisplay(resourceOwnerUserId: string) {
	const { membersMap } = useOrgMembers()

	const ownerMember = membersMap.get(resourceOwnerUserId)
	const { ownerFullName, ownerInitials } = resolveTaskOwnerDisplay(resourceOwnerUserId, ownerMember)

	return { ownerMember, ownerFullName, ownerInitials }
}
