import type { RiptideApiInputs, RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

export type OrganizationMember = RiptideApiOutputs['auth']['admin']['users']['list']['users'][number]
export type OrganizationInvitation = RiptideApiOutputs['auth']['admin']['invitations']['list']['invitations'][number]
export type UpdateOrganizationMemberRoleInput = RiptideApiInputs['auth']['admin']['users']['updateRole']

export function getMemberDisplayName(
	member: Pick<OrganizationMember, 'firstName' | 'lastName'>,
	fallback = 'No name',
): string {
	return [member.firstName, member.lastName].filter(Boolean).join(' ') || fallback
}

export function getMemberInitials(member: Pick<OrganizationMember, 'firstName' | 'lastName' | 'email'>): string {
	if (member.firstName || member.lastName)
		return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase()
	return member.email.charAt(0).toUpperCase()
}

export function getNextEditableRole(role: string): UpdateOrganizationMemberRoleInput['roleSlug'] {
	return role === 'admin' ? 'member' : 'admin'
}

export function findSelectedMember(
	members: ReadonlyArray<OrganizationMember>,
	selectedUserId: string | undefined,
): OrganizationMember | undefined {
	return members.find((member) => member.id === selectedUserId)
}
