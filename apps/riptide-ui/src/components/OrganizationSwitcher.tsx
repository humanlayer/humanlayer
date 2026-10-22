import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import { CompanyLogo } from '@humanlayer/ui/components/company-logo'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Building2, ChevronsUpDown, LogOutIcon, Plus } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { usePendingAccessRequestCount } from '@/hooks/admin/usePendingAccessRequestCount'
import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'
import { useRiptideApi } from '@/orpc/client'

function PendingAccessRequestBadge({ count, className }: { count: number | undefined; className?: string }) {
	if (!count) return null
	return (
		<Badge variant="destructive" className={className}>
			{count}
		</Badge>
	)
}

function AdministrationMenu({
	isAdmin,
	count,
	onSelectAccessRequests,
	onSelectUsers,
}: {
	isAdmin: boolean
	count: number | undefined
	onSelectAccessRequests: () => void
	onSelectUsers: () => void
}) {
	if (!isAdmin) return null
	return (
		<>
			<DropdownMenuLabel className="text-xs text-muted-foreground">Administration</DropdownMenuLabel>
			<DropdownMenuItem className="cursor-pointer gap-2" onClick={onSelectAccessRequests}>
				<span className="flex-1">Manage access requests</span>
				<PendingAccessRequestBadge count={count} className="h-5 min-w-5 px-1" />
			</DropdownMenuItem>
			<DropdownMenuItem className="cursor-pointer gap-2" onClick={onSelectUsers}>
				<span className="flex-1">Manage users</span>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
		</>
	)
}

export function OrganizationSwitcher({
	isOpen,
	setIsOpen,
}: {
	isOpen: boolean
	setIsOpen: Dispatch<SetStateAction<boolean>>
}) {
	const { isLoading: isAuthLoading, organizationId, roles, signOut, switchOrganization } = useBrowserAuth()
	const [isSwitching, setIsSwitching] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const navigate = useNavigate()
	const { queryClient } = useRiptideApi()
	const pendingAccessRequests = usePendingAccessRequestCount()
	const isAdmin = roles?.includes('admin') ?? false
	const pendingAccessRequestCount = pendingAccessRequests.data?.count

	// Fetch organizations list with caching
	const { data: organizationsData, isLoading: organizationsIsLoading } = useQuery(
		queryClient.auth.user.organizations.list.queryOptions({
			enabled: !isAuthLoading,
			refetchInterval: 60_000, // Refresh every minute
			staleTime: 30_000, // Consider data stale after 30 seconds
		}),
	)

	// Fetch invitations to show count
	const { data: invitationsData } = useQuery(
		queryClient.auth.user.invitations.list.queryOptions({
			enabled: !isAuthLoading,
			refetchInterval: 10_000, // Check more frequently for new invitations
		}),
	)

	const handleOrganizationSwitch = async (targetOrgId: string) => {
		if (targetOrgId === organizationId) {
			// Already in this organization
			setIsOpen(false)
			return
		}

		setIsSwitching(true)
		try {
			await switchOrganization({ organizationId: targetOrgId })
			setIsOpen(false)
			// The auth provider will handle the redirect/refresh
		} catch (error) {
			logger.error('Failed to switch organization:', error)
			captureException(error instanceof Error ? error : new Error(String(error)), {
				tags: { action: 'switchOrganization' },
				extra: { targetOrgId },
			})
			toast.error('Failed to switch organization. Please try again.')
		} finally {
			setIsSwitching(false)
		}
	}

	const activeOrganization = organizationsData?.organizations?.find((org) => org.organizationId === organizationId)

	const pendingInvitationCount = invitationsData?.invitations?.length ?? 0

	// Show loading state while fetching initial data
	if (isAuthLoading || (organizationsIsLoading && !organizationsData)) {
		return (
			<Button variant="ghost" size="icon" className="h-8 w-8" disabled>
				<SyncGridAnimation variant="snake" size="sm" speed={120} />
			</Button>
		)
	}

	// Determine what to show in the trigger button
	const hasActiveOrg = organizationId && activeOrganization

	return (
		<div className="flex flex-row items-center">
			<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button ref={buttonRef} variant="ghost" size="sm" className="relative h-8 px-2 gap-2">
								<div className="flex items-center gap-2">
									{hasActiveOrg && activeOrganization.domains?.[0] ? (
										<CompanyLogo domain={activeOrganization.domains[0]} className="h-4 w-4" />
									) : (
										<Building2 className="h-4 w-4" />
									)}
									<span className="text-xs max-w-[300px] truncate">
										{hasActiveOrg ? activeOrganization.organizationName : 'Select Organization'}
									</span>
									<ChevronsUpDown className="h-3 w-3 opacity-50" />
								</div>
								{isSwitching && <SyncGridAnimation variant="snake" size="xs" speed={120} />}
								<PendingAccessRequestBadge
									count={isAdmin ? pendingAccessRequestCount : undefined}
									className="absolute -right-2 -top-2 h-5 min-w-5 px-1 text-[10px]"
								/>
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>
						<p>{hasActiveOrg ? 'Switch organizations' : 'Select organization'}</p>
					</TooltipContent>
				</Tooltip>

				<DropdownMenuContent align="end" className="w-[240px]">
					<DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>

					{/* Organizations list */}
					{organizationsData?.organizations?.map((org) => (
						<DropdownMenuItem
							key={org.organizationId}
							onClick={() => handleOrganizationSwitch(org.organizationId)}
							disabled={isSwitching}
							className={cn('gap-2 cursor-pointer group')}
						>
							<div className={cn('flex items-center gap-2 flex-1 ')}>
								{org.domains?.[0] ? (
									<CompanyLogo domain={org.domains[0]} className="h-4 w-4" />
								) : (
									<Building2 className="h-4 w-4 group-hover:text-background " />
								)}
								<span className="truncate">{org.organizationName}</span>
							</div>
						</DropdownMenuItem>
					))}

					{/* Show message if no organizations */}
					{(!organizationsData?.organizations || organizationsData.organizations.length === 0) && (
						<div className="px-2 py-1.5 text-sm text-muted-foreground">No organizations found</div>
					)}

					<DropdownMenuSeparator />

					{/* Create organization link */}
					<DropdownMenuItem
						className="gap-2 cursor-pointer group"
						onClick={() => {
							setIsOpen(false)
							navigate({ to: '/auth/organizations/create' })
						}}
					>
						<Plus className="h-4 w-4 group-hover:text-background" />
						<span>Create Organization</span>
					</DropdownMenuItem>

					{/* Show invitations if any */}
					{pendingInvitationCount > 0 && (
						<DropdownMenuItem
							className="gap-2 cursor-pointer"
							onClick={() => {
								setIsOpen(false)
								navigate({ to: '/auth/organizations/select' })
							}}
						>
							<div className="flex items-center gap-2 flex-1">
								<Badge variant="destructive" className="h-5 px-1.5">
									{pendingInvitationCount}
								</Badge>
								<span>Pending Invitation{pendingInvitationCount > 1 ? 's' : ''}</span>
							</div>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<AdministrationMenu
						isAdmin={isAdmin}
						count={pendingAccessRequestCount}
						onSelectAccessRequests={() => {
							setIsOpen(false)
							navigate({ to: '/settings/access-requests' })
						}}
						onSelectUsers={() => {
							setIsOpen(false)
							navigate({ to: '/settings/users', search: {} })
						}}
					/>

					<DropdownMenuItem
						asChild
						onClick={() => {
							Sentry.setUser(null)
							signOut({ returnTo: window.location.origin })
						}}
						className="group cursor-pointer"
					>
						<div className="flex flex-row">
							<LogOutIcon className="size-4 group-hover:text-background" />
							<span>Sign Out</span>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	)
}
