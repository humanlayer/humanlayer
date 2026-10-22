import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Building2, Home, Mail, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { createApiClient } from '@/api/client'
import { useSwitchOrganization } from '@/hooks/useSwitchOrganization'
import { consumeAuthReturnTo } from '@/utils/auth-route-state'

export const Route = createFileRoute('/organizations/select')({
	component: OrganizationSelectPage,
})

function OrganizationSelectPage() {
	const { user, organizationId, getAccessToken } = useAuth()
	const switchToOrganization = useSwitchOrganization()
	const navigate = useNavigate()
	const [switching, setSwitching] = useState<string | null>(null)

	const { client, queryClient } = createApiClient(getAccessToken)

	const orgsQuery = useQuery({
		queryKey: queryClient.auth.user.organizations.list.key({}),
		queryFn: () => client.auth.user.organizations.list({}),
		enabled: !!user,
		staleTime: 30_000,
	})

	const invitationsQuery = useQuery({
		queryKey: queryClient.auth.user.invitations.list.key({}),
		queryFn: () => client.auth.user.invitations.list({}),
		enabled: !!user,
		refetchInterval: 10_000,
	})

	const pendingInvitations = invitationsQuery.data?.invitations ?? []

	const handleSelectOrg = async (orgId: string) => {
		setSwitching(orgId)
		try {
			await switchToOrganization({ organizationId: orgId })
			const returnTo = consumeAuthReturnTo()
			if (returnTo) {
				await navigate({
					to: returnTo.pathname,
					search: returnTo.search,
					hash: returnTo.hash,
					replace: true,
				} as never)
			} else {
				await navigate({ to: '/artifacts' })
			}
		} catch (error) {
			console.error('Failed to switch org:', error)
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to switch organization'), {
				tags: { action: 'org_switch' },
			})
			toast.error('Failed to switch organization')
			setSwitching(null)
		}
	}

	if (orgsQuery.isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<SyncGridAnimation variant="snake" speed={120} className="w-8" />
			</div>
		)
	}

	const organizations = orgsQuery.data?.organizations ?? []

	return (
		<div className="flex h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="p-6 text-center">
					<CardTitle className="font-mono uppercase tracking-wider">Select Organization</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6 px-6 pb-6">
					{organizations.length === 0 ? (
						<p className="text-center text-muted-foreground">You don't belong to any organizations yet.</p>
					) : (
						<div className="space-y-2">
							{organizations.map((org: { organizationId: string; organizationName: string }) => (
								<Button
									key={org.organizationId}
									variant="outline"
									className="w-full justify-start gap-3"
									onClick={() => handleSelectOrg(org.organizationId)}
									disabled={switching !== null}
								>
									<Building2 className="h-4 w-4" />
									<span className="truncate">{org.organizationName}</span>
									{switching === org.organizationId && (
										<SyncGridAnimation variant="snake" size="sm" speed={120} className="ml-auto" />
									)}
								</Button>
							))}
						</div>
					)}

					<div className="pt-4 border-t border-border">
						<div className="flex flex-col gap-2">
							{pendingInvitations.length > 0 && (
								<Button variant="outline" className="w-full gap-2" asChild>
									<Link to="/organizations/join">
										<Mail className="h-4 w-4" />
										View {pendingInvitations.length} pending invitation
										{pendingInvitations.length !== 1 ? 's' : ''}
									</Link>
								</Button>
							)}
							<Button variant="ghost" className="w-full gap-2" asChild>
								<Link to="/organizations/create">
									<Plus className="h-4 w-4" />
									Create Organization
								</Link>
							</Button>
							{organizationId && (
								<Button variant="ghost" className="w-full gap-2" asChild>
									<Link to="/">
										<Home className="h-4 w-4" />
										Go Home
									</Link>
								</Button>
							)}
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
