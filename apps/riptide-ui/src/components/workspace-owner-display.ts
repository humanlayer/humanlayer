import type { OrgMember } from '@/hooks/useOrgMembers'

export interface WorkspaceOwnerDisplay {
	name: string
	initials: string
	profilePictureUrl?: string
}

export function workspaceOwnerDisplay(
	member: OrgMember | undefined,
	userId: string | null,
	profilePictureUrl?: string,
): WorkspaceOwnerDisplay {
	if (!member) {
		const fallback = userId ? userId.slice(0, 8) : 'Unknown user'
		return { name: fallback, initials: '?', profilePictureUrl }
	}
	const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
	const initials =
		member.firstName || member.lastName
			? `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase()
			: member.email.slice(0, 2).toUpperCase()
	return { name, initials, profilePictureUrl: member.profilePictureUrl ?? profilePictureUrl }
}
