import { AccessRequestQueue, type AccessRequestStatus } from '@humanlayer/ui/administration/AccessRequestQueue'
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'

export function AccessRequestsTable({ onOpenInviteDialog }: { onOpenInviteDialog: (email: string) => void }) {
	const [status, setStatus] = useState<AccessRequestStatus>('pending')
	const { client, queryClient: api } = useRiptideApi()
	const cache = useQueryClient()
	const listOptions = api.auth.admin.accessRequests.list.queryOptions({ input: { status } })
	const list = useQuery({ ...listOptions, refetchOnWindowFocus: true })
	const pendingCount = useQuery({
		...api.auth.admin.accessRequests.unreadCount.queryOptions({ input: {} }),
		refetchOnWindowFocus: true,
	})
	const archivedList = useQuery({
		...api.auth.admin.accessRequests.list.queryOptions({ input: { status: 'archived' } }),
		enabled: status !== 'archived',
	})

	const archive = useMutation({
		mutationFn: (requestId: string) => client.auth.admin.accessRequests.archive({ requestId }),
		onSuccess: async () => {
			toast.success('Request archived')
			await Promise.all([
				cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.list.key() }),
				cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.unreadCount.key() }),
			])
		},
		onError: (error) => {
			if (!isDefinedError(error)) Sentry.captureException(error, { tags: { action: 'archive_access_request' } })
			toast.error('Failed to archive request')
		},
	})

	return (
		<Card className="p-4">
			<CardHeader>
				<CardTitle>Access Requests</CardTitle>
				<CardDescription>Review and invite users who requested access</CardDescription>
			</CardHeader>
			<CardContent>
				<AccessRequestQueue
					status={status}
					onStatusChange={setStatus}
					requests={list.data ?? []}
					pendingCount={pendingCount.data?.count}
					archivedCount={status === 'archived' ? list.data?.length : archivedList.data?.length}
					isLoading={list.isLoading}
					error={list.error}
					onRetry={() => void list.refetch()}
					renderArtifact={(request) =>
						request.artifactId ? (
							<a href={`/artifacts/${request.artifactId}`} className="text-primary hover:underline">
								{request.artifactTitle}
							</a>
						) : (
							<span className="text-muted-foreground">{request.artifactTitle}</span>
						)
					}
					renderPendingActions={(request) => (
						<div className="flex gap-2">
							<Button size="sm" onClick={() => onOpenInviteDialog(request.requesterEmail)}>
								Invite
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={archive.isPending}
								onClick={() => archive.mutate(request.id)}
							>
								Archive
							</Button>
						</div>
					)}
				/>
			</CardContent>
		</Card>
	)
}
