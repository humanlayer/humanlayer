import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { Settings, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSharingActions } from '@/hooks/useSharingActions'

import { UserSelector } from './UserSelector'

interface PermissionsDialogProps {
	taskId: string
	isOpen: boolean
	onOpenChange: (open: boolean) => void
}

function getUserInitials(firstName?: string, lastName?: string, email?: string): string {
	if (firstName || lastName) {
		return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()
	}
	return email ? email.charAt(0).toUpperCase() : '?'
}

export function PermissionsDialog({ taskId, isOpen, onOpenChange }: PermissionsDialogProps) {
	const { user } = useAuth()
	const { taskOrganizationAclsCollection, taskUserAclsCollection } = useSync()
	const sharingActions = useSharingActions()
	const { membersMap } = useOrgMembers()

	// Query org ACL for this task
	const { data: orgAcls } = useLiveQuery(
		(q) => {
			return q.from({ acls: taskOrganizationAclsCollection }).where(({ acls }) => eq(acls.task_id, taskId))
		},
		[taskOrganizationAclsCollection, taskId],
	)

	// Query user ACLs for this task
	const { data: userAcls } = useLiveQuery(
		(q) => {
			return q.from({ acls: taskUserAclsCollection }).where(({ acls }) => eq(acls.task_id, taskId))
		},
		[taskUserAclsCollection, taskId],
	)

	const orgAcl = orgAcls?.[0]
	const orgPermissionLevel = orgAcl?.permission_level || 'read'

	// Filter out users who already have ACLs and the current user
	const availableUsers = useMemo(() => {
		const usersWithAcls = new Set(userAcls?.map((acl) => acl.subject_user_id) || [])
		return Array.from(membersMap.values()).filter(
			(member) => member.id !== user?.id && !usersWithAcls.has(member.id),
		)
	}, [membersMap, userAcls, user?.id])

	const handleOrgPermissionChange = useCallback(
		(value: string) => {
			const permissionLevel = value as 'read' | 'edit'
			const transaction = sharingActions.updateOrgSharing({
				taskId,
				permissionLevel,
				existingAclId: orgAcl?.id,
			})
			transaction.isPersisted.promise
				.then(() => {
					toast.success(`Organization access set to ${permissionLevel}`)
				})
				.catch(() => {
					toast.error('Failed to update organization access')
				})
		},
		[sharingActions, taskId, orgAcl?.id],
	)

	const handleUserPermissionChange = useCallback(
		(existingAclId: string, subjectUserId: string, value: string) => {
			const permissionLevel = value === 'remove' ? null : (value as 'read' | 'edit')
			const transaction = sharingActions.updateUserSharing({
				taskId,
				subjectUserId,
				permissionLevel,
				existingAclId,
			})
			transaction.isPersisted.promise
				.then(() => {
					if (permissionLevel === null) {
						toast.success('User permission removed')
					} else {
						toast.success(`User permission set to ${permissionLevel}`)
					}
				})
				.catch(() => {
					toast.error('Failed to update user permission')
				})
		},
		[sharingActions, taskId],
	)

	const handleAddUser = useCallback(
		(userId: string) => {
			const transaction = sharingActions.updateUserSharing({
				taskId,
				subjectUserId: userId,
				permissionLevel: 'read',
			})
			transaction.isPersisted.promise
				.then(() => {
					toast.success('User added with read permission')
				})
				.catch(() => {
					toast.error('Failed to add user')
				})
		},
		[sharingActions, taskId],
	)

	const handleRemoveUser = useCallback(
		(existingAclId: string, subjectUserId: string) => {
			const transaction = sharingActions.updateUserSharing({
				taskId,
				subjectUserId,
				permissionLevel: null,
				existingAclId,
			})
			transaction.isPersisted.promise
				.then(() => {
					toast.success('User permission removed')
				})
				.catch(() => {
					toast.error('Failed to remove user')
				})
		},
		[sharingActions, taskId],
	)

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Settings className="h-5 w-5" />
						Manage Permissions
					</DialogTitle>
					<DialogDescription>Control who can view and edit this task</DialogDescription>
				</DialogHeader>
				<div className="space-y-6">
					{/* Section 1: Organization Access */}
					<div className="space-y-3">
						<Label className="text-sm font-medium">Organization Access</Label>
						<Select value={orgPermissionLevel} onValueChange={handleOrgPermissionChange}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select organization access level" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="read">Read</SelectItem>
								<SelectItem value="edit">Edit</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{orgPermissionLevel === 'read' && 'All organization members can view this task'}
							{orgPermissionLevel === 'edit' && 'All organization members can view and create sessions'}
						</p>
					</div>

					{/* Section 2: User Permissions */}
					<div className="space-y-3">
						<Label className="text-sm font-medium">User Permissions</Label>
						{userAcls && userAcls.length > 0 ? (
							<div className="space-y-2">
								{userAcls.map((acl) => {
									const member = membersMap.get(acl.subject_user_id)
									const fullName =
										member && [member.firstName, member.lastName].filter(Boolean).join(' ')
									const displayName = fullName || member?.email || acl.subject_user_id.slice(0, 8)
									const initials = member
										? getUserInitials(member.firstName, member.lastName, member.email)
										: '?'

									return (
										<div
											key={acl.id}
											className="flex items-center justify-between gap-2 p-2 border rounded-none"
										>
											<div className="flex items-center gap-2 min-w-0 flex-1">
												<Avatar className="h-6 w-6 shrink-0">
													<AvatarImage
														src={member?.profilePictureUrl ?? ''}
														alt={displayName}
													/>
													<AvatarFallback className="text-xs">{initials}</AvatarFallback>
												</Avatar>
												<span className="text-sm truncate">{displayName}</span>
											</div>
											<div className="flex items-center gap-2">
												<Select
													value={acl.permission_level}
													onValueChange={(value) =>
														handleUserPermissionChange(acl.id, acl.subject_user_id, value)
													}
												>
													<SelectTrigger className="w-24">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="read">Read</SelectItem>
														<SelectItem value="edit">Edit</SelectItem>
													</SelectContent>
												</Select>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleRemoveUser(acl.id, acl.subject_user_id)}
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													aria-label="Remove user"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										</div>
									)
								})}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">No individual user permissions set</p>
						)}

						{availableUsers.length > 0 ? (
							<UserSelector users={availableUsers} onSelect={handleAddUser} />
						) : (
							userAcls &&
							userAcls.length > 0 && (
								<p className="text-xs text-muted-foreground">
									All organization members have been granted permissions
								</p>
							)
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
