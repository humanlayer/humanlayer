import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { Settings, Users } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useCommandPaletteAction } from '@/hooks/useCommandPaletteAction'
import { useSharingActions } from '@/hooks/useSharingActions'

import { PermissionsDialog } from './PermissionsDialog'

/**
 * Self-contained command palette registrant + dialog host for task permission
 * actions: "Allow Org Members to Edit this Task" (sets the org ACL to edit)
 * and "Manage Task Permissions" (opens the PermissionsDialog it renders).
 *
 * Owner-gated via its own live queries, so it can be dropped onto any page
 * with a task in scope (task detail, session detail). Duplicate ACL/task
 * subscriptions with TaskSummary's own dialog are fine — TanStack DB dedupes
 * the underlying data.
 */
export function TaskPermissionsActions({ taskId }: { taskId: string }) {
	const { user } = useAuth()
	const { tasksCollection, taskOrganizationAclsCollection } = useSync()
	const sharingActions = useSharingActions()
	const [dialogOpen, setDialogOpen] = useState(false)

	const { data: taskRows } = useLiveQuery(
		(q) => q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)),
		[tasksCollection, taskId],
	)
	const isOwner = Boolean(user?.id && taskRows?.[0]?.resource_owner_user_id === user.id)

	const { data: orgAcls } = useLiveQuery(
		(q) => q.from({ acls: taskOrganizationAclsCollection }).where(({ acls }) => eq(acls.task_id, taskId)),
		[taskOrganizationAclsCollection, taskId],
	)
	const orgAclId = orgAcls?.[0]?.id
	const orgHasEdit = orgAcls?.[0]?.permission_level === 'edit'

	// Same mutation as PermissionsDialog's org-access select set to "edit".
	const handleAllowOrgEdit = useCallback(() => {
		const transaction = sharingActions.updateOrgSharing({
			taskId,
			permissionLevel: 'edit',
			existingAclId: orgAclId,
		})
		transaction.isPersisted.promise
			.then(() => {
				toast.success('Organization access set to edit')
			})
			.catch(() => {
				toast.error('Failed to update organization access')
			})
	}, [sharingActions, taskId, orgAclId])

	const handleOpenDialog = useCallback(() => setDialogOpen(true), [])

	useCommandPaletteAction({
		id: 'allow-org-edit-task',
		label: 'Allow Org Members to Edit this Task',
		icon: Users,
		enabled: isOwner && !orgHasEdit,
		onSelect: handleAllowOrgEdit,
	})

	useCommandPaletteAction({
		id: 'manage-task-permissions',
		label: 'Manage Task Permissions',
		icon: Settings,
		enabled: isOwner,
		onSelect: handleOpenDialog,
	})

	if (!isOwner) return null

	return <PermissionsDialog taskId={taskId} isOpen={dialogOpen} onOpenChange={setDialogOpen} />
}
