import { DataTable } from '@humanlayer/ui/administration/DataTable'
import { InvitationsTable } from '@humanlayer/ui/administration/InvitationsTable'
import {
	findSelectedMember,
	getNextEditableRole,
	type OrganizationMember,
	type UpdateOrganizationMemberRoleInput,
} from '@humanlayer/ui/administration/member'
import {
	MemberDetailsInformation,
	MemberDetailsProfile,
	MemberLifecycleActions,
} from '@humanlayer/ui/administration/members/MemberDetailsSections'
import {
	MemberLifecycleConfirmationDialog,
	type MemberDestructiveAction,
} from '@humanlayer/ui/administration/members/MemberLifecycleConfirmationDialog'
import { createOrganizationMemberColumns } from '@humanlayer/ui/administration/members/organization-member-columns'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Input } from '@humanlayer/ui/components/input'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Switch } from '@humanlayer/ui/components/switch'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { InvitationDialog } from '@/components/administration/InvitationDialog'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

interface UsersSettingsProps {
	selectedUserId?: string
	onSelectedUserIdChange: (userId: string | undefined) => void
}

type DestructiveUserAction = { type: MemberDestructiveAction; user: OrganizationMember }

interface MemberPendingState {
	role: boolean
	reactivate: boolean
	deactivate: boolean
	remove: boolean
	metrics: boolean
}

interface MemberDetailsProps {
	user: OrganizationMember
	collectionEnabled: boolean
	sessions?: number[]
	comments?: number[]
	statsLoading: boolean
	onClose: () => void
	onChangeRole: () => void
	onReactivate: () => void
	onSetMetricsAdvanced: (enabled: boolean) => void
	onRequestLifecycleAction: (action: MemberDestructiveAction) => void
	pending: MemberPendingState
}

function reportActionError(error: unknown, fallback: string, action: string): void {
	if (!isDefinedError(error)) Sentry.captureException(error, { tags: { action } })
	toast.error(error instanceof Error && error.message ? error.message : fallback)
}

function sumActivity(values?: number[]): number {
	return (values ?? []).reduce((total, value) => total + value, 0)
}

function MemberDetails({
	user,
	collectionEnabled,
	sessions,
	comments,
	statsLoading,
	onClose,
	onChangeRole,
	onReactivate,
	onSetMetricsAdvanced,
	onRequestLifecycleAction,
	pending,
}: MemberDetailsProps) {
	return (
		<Card className="p-4">
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>User Details</CardTitle>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Close
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				<MemberDetailsProfile user={user} />
				<MemberDetailsInformation
					user={user}
					statsLoading={statsLoading}
					sessions={sumActivity(sessions)}
					comments={sumActivity(comments)}
					activeWeeks={(sessions ?? []).filter((value) => value > 0).length}
					rolePending={pending.role}
					onChangeRole={onChangeRole}
				/>
				{collectionEnabled ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<Label className="text-sm font-medium">Advanced metrics</Label>
							<Switch
								checked={user.metricsAdvancedEnabled}
								onCheckedChange={onSetMetricsAdvanced}
								disabled={pending.metrics}
							/>
						</div>
						<p className="text-sm text-muted-foreground">
							Collect this member's commit and pull request activity for Advanced Metrics. No source code
							is collected. Changes take effect the next time their daemon starts or runs a session.
						</p>
					</div>
				) : null}
				<MemberLifecycleActions
					inactive={user.status === 'inactive'}
					reactivatePending={pending.reactivate}
					deactivatePending={pending.deactivate}
					removePending={pending.remove}
					onReactivate={onReactivate}
					onDeactivate={() => onRequestLifecycleAction('deactivate')}
					onRemove={() => onRequestLifecycleAction('remove')}
				/>
			</CardContent>
		</Card>
	)
}

export function UsersSettings({ selectedUserId, onSelectedUserIdChange }: UsersSettingsProps) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const [destructiveAction, setDestructiveAction] = useState<DestructiveUserAction | null>(null)
	const [inviteOpen, setInviteOpen] = useState(false)
	const { client, queryClient: api, authScope } = useRiptideApi()
	const cache = useQueryClient()
	const { commitTrackingEnabled, prTrackingEnabled } = useUserInfo()
	const enabled = Boolean(authScope.userId && authScope.organizationId)
	const usersOptions = api.auth.admin.users.list.queryOptions({ input: {} })
	const users = useQuery({
		...usersOptions,
		queryKey: [...usersOptions.queryKey, authScope],
		enabled,
		refetchInterval: 60_000,
	})
	const invitationsOptions = api.auth.admin.invitations.list.queryOptions({ input: {} })
	const invitations = useQuery({
		...invitationsOptions,
		queryKey: [...invitationsOptions.queryKey, authScope],
		enabled,
		refetchInterval: 30_000,
	})
	const statsInput = { weeks: 8, timezoneOffset: new Date().getTimezoneOffset(), limit: 25 }
	const sessionOptions = api.metrics.activeUsersSessions.queryOptions({ input: statsInput })
	const sessionStats = useQuery({
		...sessionOptions,
		queryKey: [...sessionOptions.queryKey, authScope],
		enabled: enabled && Boolean(selectedUserId),
	})
	const commentOptions = api.metrics.activeUsersComments.queryOptions({ input: statsInput })
	const commentStats = useQuery({
		...commentOptions,
		queryKey: [...commentOptions.queryKey, authScope],
		enabled: enabled && Boolean(selectedUserId),
	})
	const selectedUser = findSelectedMember(users.data?.users ?? [], selectedUserId)
	const scopedUsersKey = [...usersOptions.queryKey, authScope]
	const scopedInvitationsKey = [...invitationsOptions.queryKey, authScope]
	const invalidateUsers = () => cache.invalidateQueries({ queryKey: scopedUsersKey })

	const updateRole = useMutation({
		mutationFn: (input: UpdateOrganizationMemberRoleInput) => client.auth.admin.users.updateRole(input),
		onSuccess: async () => {
			await invalidateUsers()
			toast.success('User role updated successfully')
		},
		onError: (error) => reportActionError(error, 'Failed to update user role', 'update_native_user_role'),
	})
	const remove = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.remove({ userId }),
		onSuccess: async () => {
			await invalidateUsers()
			setDestructiveAction(null)
			toast.success('User removed from organization')
		},
		onError: (error) => reportActionError(error, 'Failed to remove user', 'remove_native_user'),
	})
	const deactivate = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.deactivate({ userId }),
		onSuccess: async () => {
			await invalidateUsers()
			setDestructiveAction(null)
			toast.success('User deactivated')
		},
		onError: (error) => reportActionError(error, 'Failed to deactivate user', 'deactivate_native_user'),
	})
	const reactivate = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.reactivate({ userId }),
		onSuccess: async () => {
			await invalidateUsers()
			toast.success('User reactivated')
		},
		onError: (error) => reportActionError(error, 'Failed to reactivate user', 'reactivate_native_user'),
	})
	const setMetrics = useMutation({
		mutationFn: (input: { userId: string; enabled: boolean }) =>
			client.auth.admin.users.setMetricsAdvancedEnabled(input),
		onSuccess: async (result) => {
			await invalidateUsers()
			toast.success(result.metricsAdvancedEnabled ? 'Advanced metrics enabled' : 'Advanced metrics disabled')
		},
		onError: (error) =>
			reportActionError(error, 'Failed to update advanced metrics', 'set_native_metrics_advanced'),
	})
	const revoke = useMutation({
		mutationFn: (invitationId: string) => client.auth.admin.invitations.revoke({ invitationId }),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: scopedInvitationsKey })
			toast.success('Invitation revoked')
		},
		onError: (error) => reportActionError(error, 'Failed to revoke invitation', 'revoke_native_invitation'),
	})

	const requestLifecycleAction = (type: MemberDestructiveAction, user: OrganizationMember) =>
		setDestructiveAction({ type, user })
	const columns = createOrganizationMemberColumns({
		onSelect: (user) => onSelectedUserIdChange(user.id),
		onChangeRole: (user) => updateRole.mutate({ userId: user.id, roleSlug: getNextEditableRole(user.role) }),
		onReactivate: (user) => reactivate.mutate(user.id),
		onRequestLifecycleAction: requestLifecycleAction,
		rolePending: updateRole.isPending,
		reactivatePending: reactivate.isPending,
		deactivatePending: deactivate.isPending,
		removePending: remove.isPending,
		metricsAdvanced:
			commitTrackingEnabled || prTrackingEnabled
				? {
						onToggle: (user, value) => setMetrics.mutate({ userId: user.id, enabled: value }),
						pending: setMetrics.isPending,
					}
				: undefined,
	})
	const setColumnFilter = (id: string, value: string) =>
		setColumnFilters((current) =>
			value === 'all'
				? current.filter((filter) => filter.id !== id)
				: [...current.filter((filter) => filter.id !== id), { id, value }],
		)
	const roleFilter = (columnFilters.find((filter) => filter.id === 'role')?.value as string | undefined) ?? 'all'
	const statusFilter = (columnFilters.find((filter) => filter.id === 'status')?.value as string | undefined) ?? 'all'
	const sessions = sessionStats.data?.users.find((entry) => entry.userId === selectedUser?.id)?.values
	const comments = commentStats.data?.users.find((entry) => entry.userId === selectedUser?.id)?.values
	const confirmLifecycle = () => {
		if (!destructiveAction) return
		if (destructiveAction.type === 'deactivate') deactivate.mutate(destructiveAction.user.id)
		else remove.mutate(destructiveAction.user.id)
	}

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<Card className={selectedUser ? 'p-4 xl:col-span-2' : 'p-4 xl:col-span-3'}>
					<CardHeader>
						<CardTitle>Organization Members</CardTitle>
						<CardDescription>
							View and manage active and inactive members in your organization
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex flex-col gap-2 sm:flex-row">
							<Input
								placeholder="Search users..."
								value={globalFilter}
								onChange={(event) => setGlobalFilter(event.target.value)}
								className="flex-1 sm:max-w-sm"
							/>
							<Select value={roleFilter} onValueChange={(value) => setColumnFilter('role', value)}>
								<SelectTrigger className="w-full sm:w-[160px]">
									<SelectValue placeholder="Filter by role" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Roles</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
									<SelectItem value="member">Member</SelectItem>
								</SelectContent>
							</Select>
							<Select value={statusFilter} onValueChange={(value) => setColumnFilter('status', value)}>
								<SelectTrigger className="w-full sm:w-[160px]">
									<SelectValue placeholder="Filter by status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Statuses</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
							<Button className="sm:ml-auto" onClick={() => setInviteOpen(true)}>
								<UserPlus className="h-4 w-4" />
								Invite User
							</Button>
						</div>
						{users.isError ? (
							<div className="space-y-3 py-12 text-center text-sm text-muted-foreground" role="alert">
								<p>Unable to load organization members.</p>
								<Button variant="outline" size="sm" onClick={() => void users.refetch()}>
									Retry
								</Button>
							</div>
						) : (
							<DataTable
								columns={columns}
								data={users.data?.users ?? []}
								sorting={sorting}
								onSortingChange={setSorting}
								columnFilters={columnFilters}
								onColumnFiltersChange={setColumnFilters}
								globalFilter={globalFilter}
								onGlobalFilterChange={setGlobalFilter}
								isLoading={users.isLoading}
							/>
						)}
					</CardContent>
				</Card>
				{selectedUser ? (
					<MemberDetails
						user={selectedUser}
						collectionEnabled={commitTrackingEnabled || prTrackingEnabled}
						sessions={sessions}
						comments={comments}
						statsLoading={sessionStats.isLoading || commentStats.isLoading}
						onClose={() => onSelectedUserIdChange(undefined)}
						onChangeRole={() =>
							updateRole.mutate({
								userId: selectedUser.id,
								roleSlug: getNextEditableRole(selectedUser.role),
							})
						}
						onReactivate={() => reactivate.mutate(selectedUser.id)}
						onSetMetricsAdvanced={(value) => setMetrics.mutate({ userId: selectedUser.id, enabled: value })}
						onRequestLifecycleAction={(type) => requestLifecycleAction(type, selectedUser)}
						pending={{
							role: updateRole.isPending,
							reactivate: reactivate.isPending,
							deactivate: deactivate.isPending,
							remove: remove.isPending,
							metrics: setMetrics.isPending,
						}}
					/>
				) : null}
			</div>
			<InvitationsTable
				invitations={invitations.data?.invitations ?? []}
				isLoading={invitations.isLoading}
				error={invitations.error}
				isRevokePending={revoke.isPending}
				onRetry={() => void invitations.refetch()}
				onRevoke={(invitationId) => revoke.mutate(invitationId)}
				onOpenInviteDialog={() => setInviteOpen(true)}
			/>
			{inviteOpen ? (
				<InvitationDialog
					key={`${authScope.userId}:${authScope.organizationId}:users`}
					open
					onOpenChange={setInviteOpen}
				/>
			) : null}
			{destructiveAction ? (
				<HotkeyScopeBoundary
					scope={HOTKEY_SCOPES.ADMIN_MEMBER_DIALOG}
					isActive
					rootScopeDisabled
					componentName="AdminMemberLifecycleDialog"
				>
					<MemberLifecycleConfirmationDialog
						action={destructiveAction.type}
						email={destructiveAction.user.email}
						open
						pending={deactivate.isPending || remove.isPending}
						onOpenChange={(open) => {
							if (!open) setDestructiveAction(null)
						}}
						onConfirm={confirmLifecycle}
					/>
				</HotkeyScopeBoundary>
			) : null}
		</div>
	)
}
