import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { type OrgMember, useOrgMembers } from '@/hooks/useOrgMembers'

export type TaskDiffComment = DiffComment & {
	author: OrgMember | undefined
}

export function useTaskDiffComments(taskId: string) {
	const { diffCommentsCollection } = useSync()
	const { membersMap, isLoading: areMembersLoading } = useOrgMembers()
	const query = useLiveQuery(
		(q) => q.from({ comments: diffCommentsCollection }).where(({ comments }) => eq(comments.task_id, taskId)),
		[diffCommentsCollection, taskId],
	)

	const rows = useMemo(
		() =>
			((query.data ?? []) as DiffComment[]).map((comment) => ({
				...comment,
				author: membersMap.get(comment.created_by_user_id),
			})),
		[query.data, membersMap],
	)

	return { rows, isLoading: query.isLoading || areMembersLoading }
}
