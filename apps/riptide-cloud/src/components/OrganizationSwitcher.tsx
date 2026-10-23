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
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Building2, ChevronsUpDown, LogOut, Mail, Plus } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { useSwitchOrganization } from '@/hooks/useSwitchOrganization'

export const OrganizationSwitcher: FC = () => {
	const { organizationId, signOut } = useAuth()
	const switchToOrganization = useSwitchOrganization()
	const navigate = useNavigate()
	const { queryClient } = useRiptideApi()
	const [switching, setSwitching] = useState(false)

	const orgsQuery = useQuery(
		queryClient.auth.user.organizations.list.queryOptions({
			input: {},
			refetchInterval: 60_000,
			staleTime: 30_000,
		}),
	)

	const invitationsQuery = useQuery(
		queryClient.auth.user.invitations.list.queryOptions({
			input: {},
			refetchInterval: 60_000,
			staleTime: 30_000,
		}),
	)

	const pendingInvitationCount = (invitationsQuery.data?.invitations ?? []).length

	const activeOrg = orgsQuery.data?.organizations?.find((o) => o.organizationId === organizationId)

	const handleSwitch = async (orgId: string) => {
		if (orgId === organizationId) return
		setSwitching(true)
		try {
			await switchToOrganization({ organizationId: orgId })
			// AuthKit updates context state automatically, React will re-render
		} catch (error) {
			console.error('Failed to switch org:', error)
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to switch organization'), {
				tags: { action: 'org_switch' },
			})
			toast.error('Failed to switch organization')
		} finally {
			setSwitching(false)
		}
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="relative gap-2 h-8">
					<Building2 className="h-4 w-4" />
					{orgsQuery.isLoading ? (
						<SyncGridAnimation variant="snake" size="xs" speed={120} />
					) : (
						<span className="text-xs max-w-[200px] truncate">
							{activeOrg?.organizationName || 'Select Organization'}
						</span>
					)}
					<ChevronsUpDown className="h-3 w-3 opacity-50" />
					{switching && <SyncGridAnimation variant="snake" size="xs" speed={120} />}
					{pendingInvitationCount > 0 && (
						<Badge className="absolute bg-destructive text-background animate-bounce size-5 -top-2 -right-2 text-xs flex items-center justify-center p-0">
							{pendingInvitationCount}
						</Badge>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[240px] w-fit">
				<DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>

				{orgsQuery.data?.organizations?.map((org) => (
					<DropdownMenuItem
						key={org.organizationId}
						onClick={() => handleSwitch(org.organizationId)}
						disabled={switching}
						className="cursor-pointer"
					>
						<Building2 className="h-4 w-4 mr-2" />
						<span className="truncate">{org.organizationName}</span>
					</DropdownMenuItem>
				))}

				{pendingInvitationCount > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => navigate({ to: '/organizations/join' })}>
							<Mail className="h-4 w-4 mr-2" />
							View {pendingInvitationCount} pending invitation{pendingInvitationCount !== 1 ? 's' : ''}
						</DropdownMenuItem>
					</>
				)}

				<DropdownMenuSeparator />

				<DropdownMenuItem className="cursor-pointer" onClick={() => navigate({ to: '/organizations/create' })}>
					<Plus className="h-4 w-4 mr-2" />
					Create Organization
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					className="cursor-pointer"
					onClick={() => signOut({ returnTo: window.location.origin })}
				>
					<LogOut className="h-4 w-4 mr-2" />
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
