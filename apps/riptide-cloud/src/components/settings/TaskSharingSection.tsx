import { Label } from '@humanlayer/ui/components/label'
import { Switch } from '@humanlayer/ui/components/switch'
import * as Sentry from '@sentry/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'

export function TaskSharingSection() {
	const { queryClient: apiQueryClient } = useRiptideApi()

	const orgSettingsQuery = useQuery(
		apiQueryClient.auth.admin.organizations.settings.get.queryOptions({
			input: {},
			refetchInterval: 10_000,
		}),
	)

	const updateOrgSettingsMutation = useMutation(
		apiQueryClient.auth.admin.organizations.settings.set.mutationOptions({
			onSuccess: () => {
				toast.success('Task sharing settings updated')
				void orgSettingsQuery.refetch()
			},
			onError: (error: unknown) => {
				Sentry.captureException(
					error instanceof Error ? error : new Error('Failed to update task sharing settings'),
					{ tags: { action: 'update_task_sharing_settings' } },
				)
				toast.error(error instanceof Error ? error.message : 'Failed to update task sharing settings')
			},
		}),
	)

	return (
		<section>
			<div className="mb-4">
				<h2 className="text-base font-semibold">Task Sharing</h2>
				<p className="text-sm text-muted-foreground">
					Control how new tasks are shared with everyone in your organization.
				</p>
			</div>
			<div className="space-y-2">
				<div className="grid grid-cols-[auto_12rem_1fr] gap-x-4 items-start py-2">
					<Switch
						id="default-task-share-level"
						checked={orgSettingsQuery.data?.defaultTaskShareLevel === 'edit'}
						onCheckedChange={(checked) =>
							updateOrgSettingsMutation.mutate({ defaultTaskShareLevel: checked ? 'edit' : 'read' })
						}
						disabled={orgSettingsQuery.isLoading || updateOrgSettingsMutation.isPending}
						className="mt-0.5"
					/>
					<Label htmlFor="default-task-share-level" className="cursor-pointer text-sm font-medium">
						Allow org members to edit shared tasks by default
					</Label>
					<div className="space-y-2 text-sm text-muted-foreground">
						<p>
							When enabled, new tasks are shared at edit instead of read, so members can create their own
							sessions and modify artifacts without the owner granting access first.
						</p>
						<p>
							When disabled, new tasks stay shared at read, matching today's behavior. Owners can still
							change sharing on any individual task.
						</p>
					</div>
				</div>
			</div>
		</section>
	)
}
