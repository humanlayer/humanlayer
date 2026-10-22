import {
	AccessRequestQueue,
	type AccessRequestItem,
	type AccessRequestStatus,
} from '@humanlayer/ui/administration/AccessRequestQueue'
import { Button } from '@humanlayer/ui/components/button'
import { Switch } from '@humanlayer/ui/components/switch'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { InvitationDialog } from '@/components/administration/InvitationDialog'
import { openCloudUrl } from '@/lib/url-opener'
import { useRiptideApi } from '@/orpc/client'
import { getArtifactCloudUrl } from '@/utils/artifact-links'

export function AccessRequestsSettings() {
	const [status, setStatus] = useState<AccessRequestStatus>('pending')
	const [inviteEmail, setInviteEmail] = useState<string | null>(null)
	const { client, queryClient: api, authScope } = useRiptideApi()
	const cache = useQueryClient()
	const enabled = Boolean(authScope.userId && authScope.organizationId)
	const listOptions = api.auth.admin.accessRequests.list.queryOptions({ input: { status } })
	const list = useQuery({
		...listOptions,
		queryKey: [...listOptions.queryKey, authScope],
		enabled,
		refetchOnWindowFocus: true,
	})
	const pendingOptions = api.auth.admin.accessRequests.unreadCount.queryOptions({ input: {} })
	const pendingCount = useQuery({
		...pendingOptions,
		queryKey: [...pendingOptions.queryKey, authScope],
		enabled,
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
	})
	const archivedOptions = api.auth.admin.accessRequests.list.queryOptions({ input: { status: 'archived' } })
	const archivedList = useQuery({
		...archivedOptions,
		queryKey: [...archivedOptions.queryKey, authScope],
		enabled: enabled && status !== 'archived',
	})
	const settingsOptions = api.auth.admin.organizations.settings.get.queryOptions({ input: {} })
	const settings = useQuery({
		...settingsOptions,
		queryKey: [...settingsOptions.queryKey, authScope],
		enabled,
		refetchInterval: 10_000,
	})

	const refreshRequests = () =>
		Promise.all([
			cache.invalidateQueries({
				queryKey: [
					...api.auth.admin.accessRequests.list.queryOptions({ input: { status: 'pending' } }).queryKey,
					authScope,
				],
			}),
			cache.invalidateQueries({ queryKey: [...archivedOptions.queryKey, authScope] }),
			cache.invalidateQueries({ queryKey: [...pendingOptions.queryKey, authScope] }),
		])
	const archive = useMutation({
		mutationFn: (requestId: string) => client.auth.admin.accessRequests.archive({ requestId }),
		onSuccess: async () => {
			await refreshRequests()
			toast.success('Request archived')
		},
		onError: (error) => {
			if (!isDefinedError(error))
				Sentry.captureException(error, { tags: { action: 'archive_native_access_request' } })
			toast.error('Failed to archive request')
		},
	})
	const updateSettings = useMutation({
		mutationFn: (accessRequestsEnabled: boolean) =>
			client.auth.admin.organizations.settings.set({ accessRequestsEnabled }),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: [...settingsOptions.queryKey, authScope] })
			toast.success('Access request settings updated')
		},
		onError: (error) => {
			Sentry.captureException(error, { tags: { action: 'update_native_access_request_settings' } })
			toast.error('Failed to update access request settings')
		},
	})

	const renderArtifact = (request: AccessRequestItem) => {
		const artifactId = request.artifactId
		return artifactId ? (
			<button
				type="button"
				className="text-left text-accent hover:underline"
				onClick={() => openCloudUrl(getArtifactCloudUrl(artifactId))}
			>
				{request.artifactTitle}
			</button>
		) : (
			<span className="text-muted-foreground">{request.artifactTitle}</span>
		)
	}

	return (
		<div className="space-y-6">
			<section className="flex items-start justify-between gap-8 border-b border-border pb-5">
				<div>
					<h2 className="text-sm font-medium text-foreground">Allow access requests</h2>
					<p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
						Allow non-members to request access to artifacts in this organization. When disabled, people
						without access see “Artifact Not Found” instead of a request-access screen.
					</p>
				</div>
				<Switch
					aria-label="Allow access requests"
					checked={settings.data?.accessRequestsEnabled ?? true}
					disabled={settings.isLoading || settings.isError || updateSettings.isPending}
					onCheckedChange={(checked) => updateSettings.mutate(checked)}
				/>
			</section>
			{settings.isError ? (
				<div className="flex items-center gap-3 text-xs text-destructive" role="alert">
					Unable to load organization settings.
					<Button size="sm" variant="outline" onClick={() => void settings.refetch()}>
						Retry
					</Button>
				</div>
			) : null}
			<AccessRequestQueue
				status={status}
				onStatusChange={setStatus}
				requests={list.data ?? []}
				pendingCount={pendingCount.data?.count}
				archivedCount={status === 'archived' ? list.data?.length : archivedList.data?.length}
				isLoading={list.isLoading}
				error={list.error}
				onRetry={() => void list.refetch()}
				renderArtifact={renderArtifact}
				renderPendingActions={(request) => (
					<div className="flex gap-2">
						<Button size="sm" onClick={() => setInviteEmail(request.requesterEmail)}>
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
			{inviteEmail ? (
				<InvitationDialog
					key={`${authScope.userId}:${authScope.organizationId}:${inviteEmail}`}
					open
					defaultEmail={inviteEmail}
					description="Invite this requester to join your organization."
					onOpenChange={(open) => {
						if (!open) setInviteEmail(null)
					}}
				/>
			) : null}
		</div>
	)
}
