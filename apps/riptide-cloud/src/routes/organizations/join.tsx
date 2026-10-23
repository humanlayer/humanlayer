import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { ArrowLeft, Building2, Home } from 'lucide-react'
import { toast } from 'sonner'

import { createApiClient } from '@/api/client'
import { useSwitchOrganization } from '@/hooks/useSwitchOrganization'
import { consumeAuthReturnTo } from '@/utils/auth-route-state'

export const Route = createFileRoute('/organizations/join')({
	component: OrganizationJoinPage,
})

function OrganizationJoinPage() {
	const { organizationId, getAccessToken } = useAuth()
	const switchToOrganization = useSwitchOrganization()
	const router = useRouter()
	const navigate = useNavigate()
	const tanstackQueryClient = useQueryClient()
	const { client, queryClient: apiQueryClient } = createApiClient(getAccessToken)

	const invitationsQuery = useQuery({
		queryKey: apiQueryClient.auth.user.invitations.list.key({}),
		queryFn: () => client.auth.user.invitations.list({}),
		refetchInterval: 10_000,
	})

	const acceptMutation = useMutation({
		mutationFn: async (invitationToken: string) => {
			return client.auth.user.invitations.accept({ invitationToken })
		},
		onSuccess: async (data) => {
			toast.success('Invitation accepted!')
			await Promise.all([
				tanstackQueryClient.invalidateQueries({
					queryKey: apiQueryClient.auth.user.invitations.list.key({}),
				}),
				tanstackQueryClient.invalidateQueries({
					queryKey: apiQueryClient.auth.user.organizations.list.key({}),
				}),
			])
			await switchToOrganization({ organizationId: data.organizationId })
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
		},
		onError: (error) => {
			Sentry.captureException(error instanceof Error ? error : new Error('Failed to accept invitation'), {
				tags: { action: 'invitation_accept' },
			})
			const message = error?.message || 'Failed to accept invitation'
			toast.error(message)
		},
	})

	const invitations = invitationsQuery.data?.invitations ?? []

	return (
		<div className="flex h-screen items-center justify-center p-4">
			<Card className="w-full max-w-md p-4">
				<CardHeader>
					<Button
						variant="ghost"
						size="sm"
						className="w-fit -ml-2 mb-2"
						onClick={() => router.history.back()}
					>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back
					</Button>
					<CardTitle className="font-mono uppercase tracking-wider">Pending Invitations</CardTitle>
				</CardHeader>
				<CardContent>
					{invitationsQuery.isLoading ? (
						<div className="flex justify-center py-8">
							<SyncGridAnimation variant="snake" size="md" speed={120} />
						</div>
					) : invitations.length === 0 ? (
						<p className="text-center text-muted-foreground py-8">No pending invitations.</p>
					) : (
						<div className="space-y-2">
							{invitations.map((invitation) => (
								<Button
									key={invitation.id}
									variant="outline"
									className="group w-full justify-between gap-3"
									onClick={() => acceptMutation.mutate(invitation.token)}
									disabled={acceptMutation.isPending}
								>
									<span className="flex items-center gap-3">
										<Building2 className="h-4 w-4" />
										<span className="truncate">
											{invitation.organization?.name || 'Unknown Organization'}
										</span>
									</span>
									{acceptMutation.isPending ? (
										<SyncGridAnimation variant="snake" size="sm" speed={120} />
									) : (
										<span className="text-xs text-muted-foreground group-hover:text-background">
											Accept
										</span>
									)}
								</Button>
							))}
						</div>
					)}
					{organizationId && (
						<div className="pt-4 border-t border-border">
							<Button variant="ghost" className="w-full gap-2" asChild>
								<Link to="/">
									<Home className="h-4 w-4" />
									Go Home
								</Link>
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
