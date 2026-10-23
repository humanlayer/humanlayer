import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { cn } from '@humanlayer/ui/lib/utils'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowUpDown, MoreHorizontal } from 'lucide-react'

import type { OrganizationMember } from '../member'
import { getMemberDisplayName, getMemberInitials } from '../member'
import { MemberStatusBadge } from './MemberStatusBadge'

type OrganizationMemberColumnActions = {
	readonly onSelect: (user: OrganizationMember) => void
	readonly onChangeRole: (user: OrganizationMember) => void
	readonly onReactivate: (user: OrganizationMember) => void
	readonly onRequestLifecycleAction: (action: 'deactivate' | 'remove', user: OrganizationMember) => void
	readonly rolePending: boolean
	readonly reactivatePending: boolean
	readonly deactivatePending: boolean
	readonly removePending: boolean
	/** Renders the per-user Advanced Metrics opt-in column when set (org has the feature on). */
	readonly metricsAdvanced?: {
		readonly onToggle: (user: OrganizationMember, enabled: boolean) => void
		readonly pending: boolean
	}
}

export function createOrganizationMemberColumns(
	actions: OrganizationMemberColumnActions,
): ColumnDef<OrganizationMember>[] {
	const metricsAdvanced = actions.metricsAdvanced
	const metricsAdvancedColumn: ColumnDef<OrganizationMember>[] = metricsAdvanced
		? [
				{
					accessorKey: 'metricsAdvancedEnabled',
					header: () => <span className="hidden sm:inline">Advanced Metrics</span>,
					cell: ({ row }) => (
						<div className="hidden sm:block">
							<Switch
								checked={row.original.metricsAdvancedEnabled}
								onCheckedChange={(checked) => metricsAdvanced.onToggle(row.original, checked)}
								disabled={metricsAdvanced.pending}
								aria-label={`Advanced metrics for ${row.original.email}`}
							/>
						</div>
					),
				},
			]
		: []

	return [
		{
			id: 'user',
			header: 'User',
			cell: ({ row }) => {
				const user = row.original
				const fullName = getMemberDisplayName(user)
				const isInactive = user.status === 'inactive'
				return (
					<div
						className="flex items-center space-x-2 sm:space-x-3 min-w-0 cursor-pointer group"
						onClick={() => actions.onSelect(user)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') actions.onSelect(user)
						}}
						role="button"
						tabIndex={0}
					>
						<Avatar
							className={cn('h-8 w-8 shrink-0 group-hover:border', isInactive && 'opacity-60 grayscale')}
						>
							<AvatarImage src={user.profilePictureUrl ?? ''} alt={fullName} />
							<AvatarFallback>{getMemberInitials(user)}</AvatarFallback>
						</Avatar>
						<div className="flex flex-col min-w-0">
							<div className="flex items-center gap-2">
								<span
									className={cn(
										'font-medium text-sm truncate group-hover:underline',
										isInactive && 'text-muted-foreground',
									)}
								>
									{fullName}
								</span>
								<Badge
									variant={user.role === 'admin' ? 'default' : 'secondary'}
									className="sm:hidden shrink-0"
								>
									{user.role}
								</Badge>
								<span className="sm:hidden shrink-0">
									<MemberStatusBadge status={user.status} />
								</span>
							</div>
							<span className="text-xs text-muted-foreground truncate">{user.email}</span>
						</div>
					</div>
				)
			},
		},
		{
			accessorKey: 'status',
			header: () => <span className="hidden sm:inline">Status</span>,
			filterFn: 'equalsString',
			cell: ({ row }) => (
				<div className="hidden sm:block">
					<MemberStatusBadge status={row.getValue('status')} />
				</div>
			),
		},
		{
			accessorKey: 'role',
			header: () => <span className="hidden sm:inline">Role</span>,
			cell: ({ row }) => {
				const role = row.getValue<string>('role')
				return (
					<div className="hidden sm:block">
						<Badge variant={role === 'admin' ? 'default' : 'secondary'}>{role}</Badge>
					</div>
				)
			},
		},
		{
			accessorKey: 'createdAt',
			header: ({ column }) => (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
					className="hidden md:inline-flex"
				>
					Joined
					<ArrowUpDown className="ml-2 h-4 w-4" />
				</Button>
			),
			cell: ({ row }) => {
				const createdAt = row.getValue<string>('createdAt')
				return (
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="hidden cursor-help md:block">{formatCompactRelativeTime(createdAt)}</span>
						</TooltipTrigger>
						<TooltipContent>{formatLocalAbsoluteTime(createdAt)}</TooltipContent>
					</Tooltip>
				)
			},
		},
		...metricsAdvancedColumn,
		{
			id: 'actions',
			cell: ({ row }) => {
				const user = row.original
				const isInactive = user.status === 'inactive'
				return (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" className="h-8 w-8 p-0">
								<span className="sr-only">Open menu</span>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuLabel>Actions</DropdownMenuLabel>
							<DropdownMenuItem onClick={() => actions.onSelect(user)}>View details</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => actions.onChangeRole(user)} disabled={actions.rolePending}>
								Change to {user.role === 'admin' ? 'Member' : 'Admin'}
							</DropdownMenuItem>
							{isInactive && (
								<DropdownMenuItem
									onClick={() => actions.onReactivate(user)}
									disabled={actions.reactivatePending}
								>
									Reactivate user
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							{!isInactive && (
								<DropdownMenuItem
									variant="destructive"
									onClick={() => actions.onRequestLifecycleAction('deactivate', user)}
									disabled={actions.deactivatePending}
								>
									Deactivate user
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								variant="destructive"
								onClick={() => actions.onRequestLifecycleAction('remove', user)}
								disabled={actions.removePending}
							>
								Remove from organization
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)
			},
		},
	]
}
