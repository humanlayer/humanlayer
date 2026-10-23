import { getMemberDisplayName, getMemberInitials } from '@humanlayer/ui/administration/member'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useRiptideApi } from '@/api/client'

export interface OrgMember {
	id: string
	email: string
	firstName?: string
	lastName?: string
	profilePictureUrl?: string
}

/**
 * An {@link OrgMember} with the display fields every caller derives — name,
 * initials, avatar — resolved once through the canonical helpers so no call
 * site re-implements `firstName + lastName || email`.
 */
export interface ResolvedMember extends OrgMember {
	displayName: string
	initials: string
	avatarUrl?: string
}

function resolveMember(member: OrgMember): ResolvedMember {
	return {
		...member,
		displayName: getMemberDisplayName(member, member.email),
		initials: getMemberInitials(member),
		avatarUrl: member.profilePictureUrl,
	}
}

export function useOrgMembers() {
	const { queryClient } = useRiptideApi()

	const { data, isLoading } = useQuery(
		queryClient.organization.members.list.queryOptions({
			input: {},
			staleTime: 300_000, // 5 min
			refetchInterval: 300_000, // 5 min
		}),
	)

	const membersMap = useMemo(() => {
		const map = new Map<string, OrgMember>()
		if (data?.members) {
			for (const member of data.members) {
				map.set(member.id, member)
			}
		}
		return map
	}, [data])

	const members = useMemo<ResolvedMember[]>(() => Array.from(membersMap.values(), resolveMember), [membersMap])

	/**
	 * `userId → { displayName, avatarUrl }` lookup, in the shape the artifact
	 * comment controller and comment-thread components consume. Built once here
	 * so viewers don't each re-adapt {@link members} into the same map.
	 */
	const identityMap = useMemo(() => {
		const map = new Map<string, { displayName?: string; avatarUrl?: string }>()
		for (const member of members) {
			map.set(member.id, { displayName: member.displayName, avatarUrl: member.avatarUrl })
		}
		return map
	}, [members])

	/** Resolve a WorkOS user id (`user_…`) to display fields, or `undefined` if unknown. */
	const memberFor = useCallback(
		(id: string): ResolvedMember | undefined => {
			const member = membersMap.get(id)
			return member ? resolveMember(member) : undefined
		},
		[membersMap],
	)

	return { membersMap, members, memberFor, identityMap, isLoading }
}
