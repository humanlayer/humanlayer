import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useRiptideApi } from '@/orpc/client'

export interface OrgMember {
	id: string
	email: string
	firstName?: string
	lastName?: string
	profilePictureUrl?: string
}

export function useOrgMembers() {
	const { queryClient } = useRiptideApi()

	const { data, isLoading } = useQuery(
		queryClient.organization.members.list.queryOptions({
			input: {},
			staleTime: 0,
			refetchOnMount: 'always',
			refetchInterval: 900_000, // 15 min
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

	return { membersMap, isLoading }
}

export function useActiveOrgMembers() {
	const { queryClient } = useRiptideApi()

	const { data, isLoading } = useQuery(
		queryClient.organization.members.listActive.queryOptions({
			input: {},
			staleTime: 900_000,
			refetchInterval: 900_000,
		}),
	)

	return { members: data?.members ?? [], isLoading }
}
