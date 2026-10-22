import type { ConversationSender } from '@humanlayer/ui/components/conversation-stream'

import type { OrgMember } from '@/hooks/useOrgMembers'

export function getSenderPresentation(member: OrgMember | undefined): ConversationSender | undefined {
	if (!member) return undefined

	const displayName = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
	const initials =
		[member.firstName, member.lastName]
			.filter(Boolean)
			.map((part) => part?.[0])
			.join('')
			.toUpperCase() || member.email.slice(0, 2).toUpperCase()

	return {
		displayName,
		initials,
		profilePictureUrl: member.profilePictureUrl,
	}
}

export function hasMultipleResolvedSenders(
	userIds: Iterable<string | null | undefined>,
	membersMap: Map<string, OrgMember>,
): boolean {
	const resolvedIds = new Set<string>()
	for (const userId of userIds) {
		if (userId && membersMap.has(userId)) resolvedIds.add(userId)
		if (resolvedIds.size > 1) return true
	}
	return false
}
