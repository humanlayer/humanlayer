import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import type { TaskOrganizationAclsCollection } from '@/collections/electric/task-organization-acls'
import type { TaskUserAclsCollection } from '@/collections/electric/task-user-acls'
import type { QueryTaskOrganizationAclsCollection } from '@/collections/query/task-organization-acls'
import type { QueryTaskUserAclsCollection } from '@/collections/query/task-user-acls'

type AclPermissionLevel = 'read' | 'edit' | 'comment'

const PERMISSION_RANK: Record<AclPermissionLevel, number> = {
	read: 1,
	comment: 2,
	edit: 3,
}

function maxPermission(a: AclPermissionLevel | null, b: AclPermissionLevel | null): AclPermissionLevel | null {
	if (!a) return b
	if (!b) return a
	return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b
}

interface TaskLike {
	id: string
	resource_owner_user_id: string
}

export function useTaskPermissions(
	task: TaskLike | undefined,
	userId: string | undefined,
	taskOrgAclsCollection: TaskOrganizationAclsCollection | QueryTaskOrganizationAclsCollection,
	taskUserAclsCollection: TaskUserAclsCollection | QueryTaskUserAclsCollection,
) {
	const { data: orgAcls } = useLiveQuery(
		(q) => {
			if (!task) return undefined
			return q.from({ acls: taskOrgAclsCollection }).where(({ acls }) => eq(acls.task_id, task.id))
		},
		[taskOrgAclsCollection, task?.id],
	)

	const { data: userAcls } = useLiveQuery(
		(q) => {
			if (!task || !userId) return undefined
			return q.from({ acls: taskUserAclsCollection }).where(({ acls }) => eq(acls.task_id, task.id))
		},
		[taskUserAclsCollection, task?.id, userId],
	)

	return useMemo(() => {
		const isOwner = !!task && !!userId && task.resource_owner_user_id === userId

		if (isOwner) {
			return {
				isOwner: true,
				canEditTask: true,
				canCreateSession: true,
				canRead: true,
				effectivePermission: 'edit' as AclPermissionLevel,
			}
		}

		// Compute effective permission from ACLs
		const userAclPerm =
			(userAcls?.find((a) => a.subject_user_id === userId)?.permission_level as AclPermissionLevel | undefined) ??
			null
		const orgAclPerm = (orgAcls?.[0]?.permission_level as AclPermissionLevel | undefined) ?? null
		const effectivePermission = maxPermission(userAclPerm, orgAclPerm)

		return {
			isOwner: false,
			canEditTask: effectivePermission === 'edit',
			canCreateSession: effectivePermission === 'edit',
			canRead: !!effectivePermission,
			effectivePermission,
		}
	}, [task?.id, task?.resource_owner_user_id, userId, orgAcls, userAcls])
}
