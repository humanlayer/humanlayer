import { DataTable } from '@humanlayer/ui/administration/DataTable'
import {
	getNextEditableRole,
	type OrganizationMember as AdminOrganizationMember,
} from '@humanlayer/ui/administration/member'
import { MemberLifecycleConfirmationDialog } from '@humanlayer/ui/administration/members/MemberLifecycleConfirmationDialog'
import { createOrganizationMemberColumns } from '@humanlayer/ui/administration/members/organization-member-columns'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Input } from '@humanlayer/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { useUserInfo } from '@/hooks/useUserInfo'

type DestructiveUserAction = {
	type: 'deactivate' | 'remove'
	user: AdminOrganizationMember
}

interface UsersTableProps {
	onUserSelect: (user: AdminOrganizationMember) => void
}

export function UsersTable({ onUserSelect }: UsersTableProps) {
	const [sorting, setSorting] = useState<SortingState>([])
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [globalFilter, setGlobalFilter] = useState('')
	const [destructiveAction, setDestructiveAction] = useState<DestructiveUserAction | null>(null)

	const { client, queryClient: apiQueryClient } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()

	// Fetch users
	const { data, isLoading } = useQuery(
		apiQueryClient.auth.admin.users.list.queryOptions({
			input: {},
			refetchInterval: 60_000, // Refresh every minute
		}),
	)

	const invalidateUsersListQuery = async () => {
		await tanstackQueryClient.invalidateQueries({
			queryKey: apiQueryClient.auth.admin.users.list.key({}),
		})
	}

	const setColumnFilter = (id: string, value: string) => {
		setColumnFilters((currentFilters) => {
			const nextFilters = currentFilters.filter((filter) => filter.id !== id)
			return value === 'all' ? nextFilters : [...nextFilters, { id, value }]
		})
	}

	const roleFilterValue = (columnFilters.find((filter) => filter.id === 'role')?.value as string | undefined) ?? 'all'
	const statusFilterValue =
		(columnFilters.find((filter) => filter.id === 'status')?.value as string | undefined) ?? 'all'

	const updateRoleMutation = useMutation({
		mutationFn: (variables: { userId: string; roleSlug: 'admin' | 'member' }) =>
			client.auth.admin.users.updateRole(variables),
		onSuccess: async () => {
			toast.success('User role updated successfully')
			await invalidateUsersListQuery()
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to update user role'), {
				tags: { action: 'update_user_role' },
			})
			toast.error('Failed to update user role')
		},
	})

	const removeUserMutation = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.remove({ userId }),
		onSuccess: async () => {
			toast.success('User removed from organization')
			setDestructiveAction(null)
			await invalidateUsersListQuery()
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to remove user'), {
				tags: { action: 'remove_user' },
			})
			toast.error('Failed to remove user')
		},
	})

	const deactivateUserMutation = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.deactivate({ userId }),
		onSuccess: async () => {
			toast.success('User deactivated')
			setDestructiveAction(null)
			await invalidateUsersListQuery()
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to deactivate user'), {
				tags: { action: 'deactivate_user' },
			})
			toast.error(error instanceof Error ? error.message : 'Failed to deactivate user')
		},
	})

	const reactivateUserMutation = useMutation({
		mutationFn: (userId: string) => client.auth.admin.users.reactivate({ userId }),
		onSuccess: async () => {
			toast.success('User reactivated')
			await invalidateUsersListQuery()
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to reactivate user'), {
				tags: { action: 'reactivate_user' },
			})
			toast.error(error instanceof Error ? error.message : 'Failed to reactivate user')
		},
	})

	// Gated on COLLECTION, not on the dashboard display flag: the two are independent switches, and
	// "collecting with the dashboard off" is a supported state (phantom enablement). Now that
	// members collect by default, gating this switch on the display flag would leave such an org
	// collecting org-wide with no way for its admin to exclude anyone.
	const { commitTrackingEnabled, prTrackingEnabled } = useUserInfo()
	const collectionEnabled = commitTrackingEnabled || prTrackingEnabled
	const setMetricsAdvancedMutation = useMutation({
		mutationFn: (variables: { userId: string; enabled: boolean }) =>
			client.auth.admin.users.setMetricsAdvancedEnabled(variables),
		onSuccess: async (result) => {
			toast.success(result.metricsAdvancedEnabled ? 'Advanced metrics enabled' : 'Advanced metrics disabled')
			await invalidateUsersListQuery()
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to update advanced metrics'), {
				tags: { action: 'set_metrics_advanced' },
			})
			toast.error('Failed to update advanced metrics')
		},
	})

	const confirmDestructiveAction = () => {
		if (!destructiveAction) return
		if (destructiveAction.type === 'deactivate') {
			deactivateUserMutation.mutate(destructiveAction.user.id)
		} else {
			removeUserMutation.mutate(destructiveAction.user.id)
		}
	}

	const columns = createOrganizationMemberColumns({
		onSelect: onUserSelect,
		onChangeRole: (user) =>
			updateRoleMutation.mutate({ userId: user.id, roleSlug: getNextEditableRole(user.role) }),
		onReactivate: (user) => reactivateUserMutation.mutate(user.id),
		onRequestLifecycleAction: (type, user) => setDestructiveAction({ type, user }),
		rolePending: updateRoleMutation.isPending,
		reactivatePending: reactivateUserMutation.isPending,
		deactivatePending: deactivateUserMutation.isPending,
		removePending: removeUserMutation.isPending,
		metricsAdvanced: collectionEnabled
			? {
					onToggle: (user, enabled) => setMetricsAdvancedMutation.mutate({ userId: user.id, enabled }),
					pending: setMetricsAdvancedMutation.isPending,
				}
			: undefined,
	})

	const destructiveActionIsPending = deactivateUserMutation.isPending || removeUserMutation.isPending
	return (
		<>
			<Card className="p-4">
				<CardHeader>
					<CardTitle>Organization Members</CardTitle>
					<CardDescription>View and manage active and inactive members in your organization</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{/* Search, filters, and invite button */}
						<div className="flex flex-col sm:flex-row gap-2">
							<Input
								placeholder="Search users..."
								value={globalFilter}
								onChange={(e) => setGlobalFilter(e.target.value)}
								className="flex-1 sm:max-w-sm"
							/>
							<Select value={roleFilterValue} onValueChange={(value) => setColumnFilter('role', value)}>
								<SelectTrigger className="w-full sm:w-[180px]">
									<SelectValue placeholder="Filter by role" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Roles</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
									<SelectItem value="member">Member</SelectItem>
								</SelectContent>
							</Select>
							<Select
								value={statusFilterValue}
								onValueChange={(value) => setColumnFilter('status', value)}
							>
								<SelectTrigger className="w-full sm:w-[180px]">
									<SelectValue placeholder="Filter by status" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All Statuses</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="inactive">Inactive</SelectItem>
								</SelectContent>
							</Select>
							<Button asChild className="w-full sm:w-auto ml-auto">
								<Link to="/admin/invitations">
									<UserPlus className="mr-2 h-4 w-4" />
									Invite User
								</Link>
							</Button>
						</div>

						{/* Table - using the reusable DataTable component */}
						<DataTable
							columns={columns}
							data={data?.users ?? []}
							sorting={sorting}
							onSortingChange={setSorting}
							columnFilters={columnFilters}
							onColumnFiltersChange={setColumnFilters}
							globalFilter={globalFilter}
							onGlobalFilterChange={setGlobalFilter}
							isLoading={isLoading}
						/>
					</div>
				</CardContent>
			</Card>

			{destructiveAction && (
				<MemberLifecycleConfirmationDialog
					action={destructiveAction.type}
					email={destructiveAction.user.email}
					open
					pending={destructiveActionIsPending}
					onOpenChange={(open) => !open && setDestructiveAction(null)}
					onConfirm={confirmDestructiveAction}
				/>
			)}
		</>
	)
}
