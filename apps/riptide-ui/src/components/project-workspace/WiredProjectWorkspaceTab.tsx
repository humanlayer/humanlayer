import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'
import { isDefinedError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { RepositorySourceRecoveryDialog } from '@/components/RepositorySourceSetupDialog'
import { workspaceOwnerDisplay } from '@/components/workspace-owner-display'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useIsColocated } from '@/hooks/use-colocated'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

import { projectWorkspaceRepositoryKey } from './project-workspace-repository-key'
import { ProjectWorkspaceTab } from './ProjectWorkspaceTab'

type WorkspaceStatus = RiptideApiOutputs['projectWorkspaces']['getStatus']

const repositoriesIn = (status: WorkspaceStatus) =>
	status.materializations.flatMap((materialization) => materialization.repositories)

export function WiredProjectWorkspaceTab({ taskId }: { taskId: string }) {
	const projectsV2Enabled = useSettingsStore((state) => state.projectsV2Enabled)
	const { user } = useAuth()
	const { membersMap } = useOrgMembers()
	const { queryClient: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const [busyRepositoryKey, setBusyRepositoryKey] = useState<string | null>(null)
	const [sourceRecoveryRepository, setSourceRecoveryRepository] = useState<
		ReturnType<typeof repositoriesIn>[number] | null
	>(null)
	const { isColocated: sourceRecoveryIsColocated } = useIsColocated(sourceRecoveryRepository?.status.hostId ?? '')
	const queryOptions = api.projectWorkspaces.getStatus.queryOptions({ input: { taskId } })
	const statusQuery = useQuery({
		...queryOptions,
		refetchInterval: (query) =>
			query.state.data &&
			repositoriesIn(query.state.data).every(
				(repository) => repository.status.status === 'done' || repository.status.error !== null,
			)
				? false
				: 1_000,
	})
	const invalidate = () => queryClient.invalidateQueries({ queryKey: queryOptions.queryKey })
	const retry = useMutation(
		api.projectWorkspaces.retryRepositorySetup.mutationOptions({
			onSuccess: () => void invalidate(),
			onError: (error) => {
				if (isDefinedError(error) && error.code === 'NOTHING_TO_RETRY') {
					void invalidate()
					toast.info('There is nothing to retry.')
					return
				}
				toast.error(error.message)
			},
			onSettled: () => setBusyRepositoryKey(null),
		}),
	)
	const skip = useMutation(
		api.projectWorkspaces.skipRepositorySetupStep.mutationOptions({
			onSuccess: () => void invalidate(),
			onError: (error) => toast.error(error.message),
			onSettled: () => setBusyRepositoryKey(null),
		}),
	)
	const recoverSource = useMutation(
		api.projectWorkspaces.repositorySources.recover.mutationOptions({
			onSuccess: () => {
				setSourceRecoveryRepository(null)
				void invalidate()
			},
			onError: (error) => toast.error(error.message),
			onSettled: () => setBusyRepositoryKey(null),
		}),
	)
	if (statusQuery.isPending)
		return <div className="p-3 text-xs text-muted-foreground">Loading workspace setup...</div>
	if (statusQuery.error || !statusQuery.data) {
		return <div className="p-3 text-xs text-destructive">Workspace setup could not be loaded.</div>
	}
	const repositories = repositoriesIn(statusQuery.data)
	const mutationInput = (repository: (typeof repositories)[number]) => ({
		taskId,
		hostId: repository.status.hostId,
		repositoryIdentity: repository.status.repositoryIdentity,
		expectedUpdatedAt: repository.status.updatedAt,
	})
	const ownsMaterialization = repositories.every((repository) => repository.status.userId === user?.id)
	const mutationsEnabled = projectsV2Enabled && ownsMaterialization
	const ownersByUserId = new Map(
		statusQuery.data.materializations.map((materialization) => {
			const member = membersMap.get(materialization.userId)
			const currentUserPicture =
				materialization.userId === user?.id ? (user.profilePictureUrl ?? undefined) : undefined
			return [
				materialization.userId,
				workspaceOwnerDisplay(member, materialization.userId, currentUserPicture),
			] as const
		}),
	)
	return (
		<>
			<ProjectWorkspaceTab
				status={statusQuery.data}
				mutationsEnabled={mutationsEnabled}
				mutationsDisabledMessage={
					projectsV2Enabled
						? 'Only the workspace owner can retry or skip setup steps.'
						: 'Projects V2 is disabled. Setup status remains visible, but recovery actions are unavailable.'
				}
				busyRepositoryKey={busyRepositoryKey}
				ownersByUserId={ownersByUserId}
				onRetry={(repository) => {
					setBusyRepositoryKey(projectWorkspaceRepositoryKey(repository))
					retry.mutate(mutationInput(repository))
				}}
				onSkip={(repository) => {
					setBusyRepositoryKey(projectWorkspaceRepositoryKey(repository))
					skip.mutate(mutationInput(repository))
				}}
				onChooseSource={(repository) => setSourceRecoveryRepository(repository)}
				onSwitchToManaged={(repository) => {
					setBusyRepositoryKey(projectWorkspaceRepositoryKey(repository))
					recoverSource.mutate({ ...mutationInput(repository), source: { kind: 'managed_clone' } })
				}}
			/>
			{sourceRecoveryRepository ? (
				<RepositorySourceRecoveryDialog
					repository={{
						repositoryIdentity: sourceRecoveryRepository.status.repositoryIdentity,
						default: sourceRecoveryRepository.repository.default,
						sourcePath: sourceRecoveryRepository.status.sourcePath,
					}}
					hostName={
						statusQuery.data.materializations.find(
							(materialization) => materialization.hostId === sourceRecoveryRepository.status.hostId,
						)?.hostName ?? sourceRecoveryRepository.status.hostId.slice(0, 8)
					}
					isColocated={isDesktop() && sourceRecoveryIsColocated}
					pending={recoverSource.isPending}
					onCancel={() => setSourceRecoveryRepository(null)}
					onSave={async (source) => {
						setBusyRepositoryKey(projectWorkspaceRepositoryKey(sourceRecoveryRepository))
						await recoverSource.mutateAsync({ ...mutationInput(sourceRecoveryRepository), source })
					}}
				/>
			) : null}
		</>
	)
}

export function ProjectWorkspaceAttentionMonitor({
	taskId,
	onNeedsAttention,
}: {
	taskId: string
	onNeedsAttention: () => void
}) {
	const { queryClient: api } = useRiptideApi()
	const statusQuery = useQuery({
		...api.projectWorkspaces.getStatus.queryOptions({ input: { taskId } }),
		refetchInterval: (query) =>
			query.state.data &&
			repositoriesIn(query.state.data).every((repository) => repository.status.status === 'done')
				? false
				: 1_000,
	})
	return statusQuery.data &&
		repositoriesIn(statusQuery.data).some((repository) => repository.status.error !== null) ? (
		<ProjectWorkspaceAttentionApplier onApply={onNeedsAttention} />
	) : null
}

function ProjectWorkspaceAttentionApplier({ onApply }: { onApply: () => void }) {
	useMountEffect(onApply)
	return null
}
