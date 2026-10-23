import type { OrgMember } from '@/hooks/useOrgMembers'

export interface TaskSessionCreator {
	createdByUserId?: string | null
}

export function projectTaskSessionCreators(
	currentOwnerUserId: string,
	sessions: readonly TaskSessionCreator[],
	members: ReadonlyMap<string, OrgMember>,
): OrgMember[] {
	const creatorIds = new Set<string>()
	for (const session of sessions) {
		if (session.createdByUserId && session.createdByUserId !== currentOwnerUserId) {
			creatorIds.add(session.createdByUserId)
		}
	}
	return Array.from(creatorIds)
		.map((creatorId) => members.get(creatorId))
		.filter((member): member is OrgMember => member !== undefined)
}
