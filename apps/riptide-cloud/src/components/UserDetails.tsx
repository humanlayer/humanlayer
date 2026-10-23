import {
	getNextEditableRole,
	type OrganizationMember as AdminOrganizationMember,
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
import { Button } from '@humanlayer/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@humanlayer/ui/components/card'
import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'
import { useUserInfo } from '@/hooks/useUserInfo'

interface UserDetailsProps {
	user: AdminOrganizationMember
	onClose: () => void
}

function captureUserActionError(error: unknown, fallback: string, action: string): void {
	Sentry.captureException(error instanceof Error ? error : new Error(fallback), { tags: { action } })
	toast.error(error instanceof Error ? error.message : fallback)
}

function sumActivity(values?: number[]): number {
	return (values ?? []).reduce((total, value) => total + value, 0)
}

export function UserDetails({ user, onClose }: UserDetailsProps) {
	const [confirmation, setConfirmation] = useState<MemberDestructiveAction | null>(null)
	const { client, queryClient: apiQueryClient } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const statsInput = { weeks: 8, timezoneOffset: new Date().getTimezoneOffset(), limit: 25 }
	const { data: sessionsData, isLoading: sessionsLoading } = useQuery(
		apiQueryClient.metrics.activeUsersSessions.queryOptions({ input: statsInput }),
	)
	const { data: commentsData, isLoading: commentsLoading } = useQuery(
		apiQueryClient.metrics.activeUsersComments.queryOptions({ input: statsInput }),
	)
	const invalidate = () =>
		tanstackQueryClient.invalidateQueries({ queryKey: apiQueryClient.auth.admin.users.list.key({}) })
	const updateRole = useMutation({
		mutationFn: (roleSlug: 'admin' | 'member') => client.auth.admin.users.updateRole({ userId: user.id, roleSlug }),
		onSuccess: async () => {
			toast.success('User role updated successfully')
			await invalidate()
		},
		onError: (error) => captureUserActionError(error, 'Failed to update role', 'update_user_role'),
	})
	const remove = useMutation({
		mutationFn: () => client.auth.admin.users.remove({ userId: user.id }),
		onSuccess: async () => {
			toast.success('User removed from organization')
			setConfirmation(null)
			await invalidate()
			onClose()
		},
		onError: (error) => captureUserActionError(error, 'Failed to remove user', 'remove_user'),
	})
	const deactivate = useMutation({
		mutationFn: () => client.auth.admin.users.deactivate({ userId: user.id }),
		onSuccess: async () => {
			toast.success('User deactivated')
			setConfirmation(null)
			await invalidate()
		},
		onError: (error) => captureUserActionError(error, 'Failed to deactivate user', 'deactivate_user'),
	})
	const reactivate = useMutation({
		mutationFn: () => client.auth.admin.users.reactivate({ userId: user.id }),
		onSuccess: async () => {
			toast.success('User reactivated')
			await invalidate()
		},
		onError: (error) => captureUserActionError(error, 'Failed to reactivate user', 'reactivate_user'),
	})
	// Gated on COLLECTION, not the dashboard display flag — see the same gate in UsersTable.
	const { commitTrackingEnabled, prTrackingEnabled } = useUserInfo()
	const collectionEnabled = commitTrackingEnabled || prTrackingEnabled
	const setMetricsAdvanced = useMutation({
		mutationFn: (enabled: boolean) =>
			client.auth.admin.users.setMetricsAdvancedEnabled({ userId: user.id, enabled }),
		onSuccess: async (result) => {
			toast.success(result.metricsAdvancedEnabled ? 'Advanced metrics enabled' : 'Advanced metrics disabled')
			await invalidate()
		},
		onError: (error) => captureUserActionError(error, 'Failed to update advanced metrics', 'set_metrics_advanced'),
	})
	const sessions = sessionsData?.users.find((entry) => entry.userId === user.id)?.values
	const comments = commentsData?.users.find((entry) => entry.userId === user.id)?.values
	const confirmationPending = confirmation === 'deactivate' ? deactivate.isPending : remove.isPending

	return (
		<>
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
						statsLoading={sessionsLoading || commentsLoading}
						sessions={sumActivity(sessions)}
						comments={sumActivity(comments)}
						activeWeeks={(sessions ?? []).filter((value) => value > 0).length}
						rolePending={updateRole.isPending}
						onChangeRole={() => updateRole.mutate(getNextEditableRole(user.role))}
					/>
					{collectionEnabled && (
						<div className="space-y-1">
							<div className="flex items-center justify-between">
								<Label className="text-sm font-medium">Advanced metrics</Label>
								<Switch
									checked={user.metricsAdvancedEnabled}
									onCheckedChange={(checked) => setMetricsAdvanced.mutate(checked)}
									disabled={setMetricsAdvanced.isPending}
								/>
							</div>
							<p className="text-sm text-muted-foreground">
								Collect this member's commit and pull request activity for the Advanced Metrics
								dashboards. No source code is ever collected — diffs never leave their machine. Commits
								attributed to an agent report the message and changed file paths; commits with no agent
								attribution are stripped to the sha, repo, timestamp and line counts before sending.
								Changes take effect the next time their daemon starts or runs a session, and within a
								day either way.
							</p>
						</div>
					)}
					<MemberLifecycleActions
						inactive={user.status === 'inactive'}
						reactivatePending={reactivate.isPending}
						deactivatePending={deactivate.isPending}
						removePending={remove.isPending}
						onReactivate={() => reactivate.mutate()}
						onDeactivate={() => setConfirmation('deactivate')}
						onRemove={() => setConfirmation('remove')}
					/>
				</CardContent>
			</Card>
			{confirmation && (
				<MemberLifecycleConfirmationDialog
					action={confirmation}
					email={user.email}
					open
					onOpenChange={(open) => !open && setConfirmation(null)}
					pending={confirmationPending}
					onConfirm={() => (confirmation === 'deactivate' ? deactivate.mutate() : remove.mutate())}
				/>
			)}
		</>
	)
}
