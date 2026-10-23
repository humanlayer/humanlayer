import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/** Whether the task has an org-level ACL row (shared with the whole organization). */
export function useIsTaskSharedWithOrg(taskId: string): boolean {
	const { taskOrganizationAclsCollection } = useSync()

	const { data } = useLiveQuery(
		(q) => q.from({ acls: taskOrganizationAclsCollection }).where(({ acls }) => eq(acls.task_id, taskId)),
		[taskOrganizationAclsCollection, taskId],
	)

	return (data?.length ?? 0) > 0
}
