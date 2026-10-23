import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'

import { applyOptimisticTaskDraftLaunch } from '@/actions/tasks'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { RepositorySourceSetupDialogWired } from '@/components/RepositorySourceSetupDialog'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { setLastTaskLauncherWorkingDir } from '@/lib/preferences'
import { missingRepositorySources } from '@/lib/repository-sources'
import type { LauncherV3DraftPersistence } from '@/modules/launcher-v3/launcher-v3-drafts'
import type { LauncherV3Command } from '@/modules/launcher-v3/launcher-v3-form'
import { persistLauncherAgentDefaults } from '@/modules/launcher-v3/persist-agent-defaults'
import { useRiptideApi } from '@/orpc/client'

import { useLauncherV3DraftController } from './drafts/useLauncherV3DraftController'
import { LauncherV3Form, type LauncherV3FormProps } from './LauncherV3Form'
import { type LauncherV3LaunchAdapterDependencies, useLauncherV3LaunchAdapter } from './useLauncherV3LaunchAdapter'

export interface LauncherV3LaunchWiredProps extends Omit<
	LauncherV3FormProps,
	'onSubmit' | 'operations' | 'onBack' | 'draftController' | 'getPresignedUploadUrl'
> {
	initialDraftId?: string
	draftPersistence: LauncherV3DraftPersistence
}

function rememberSuccessfulLaunch(command: LauncherV3Command, setLastUsedHostId: (hostId: string) => void): void {
	if (!command.project && command.directory) setLastTaskLauncherWorkingDir(command.hostId, command.directory)
	setLastUsedHostId(command.hostId)
	const settings = useSettingsStore.getState()
	settings.setLauncherV3PermissionsMode(command.permissionsMode)
	settings.setLauncherV3Workflow(command.workflowType, command.autoAdvance)
	persistLauncherAgentDefaults({
		agent: command.agent,
		provider: command.provider,
		model: command.model,
		effort: command.effort ?? null,
		fastMode: command.fastMode,
	})
}

export function LauncherV3LaunchWired({ initialDraftId, draftPersistence, ...formProps }: LauncherV3LaunchWiredProps) {
	const navigate = useNavigate()
	const { client, queryClient: api } = useRiptideApi()
	const tanstackQueryClient = useQueryClient()
	const { confirmTx } = useSyncInternal()
	const { eventsCollection, sessionsCollection, tasksCollection } = useSync()
	const [, setLastUsedHostId] = useLocalStorage<string | null>('riptide:lastUsedHostId', null)
	const draftController = useLauncherV3DraftController({
		initialDraftId,
		initialUploadBound: Boolean(formProps.defaultValues?.attachments?.length),
		persistence: draftPersistence,
	})
	const { lifecycle: draftLifecycle } = draftController
	const [pendingRepositorySourceCommand, setPendingRepositorySourceCommand] = useState<LauncherV3Command | null>(null)

	const dependencies = useMemo<LauncherV3LaunchAdapterDependencies>(
		() => ({
			draftLifecycle,
			repositorySourcesMissing: async (command) => {
				if (!command.project) return false
				try {
					const data = await tanstackQueryClient.fetchQuery(
						api.projects.v2.repositorySources.get.queryOptions({
							input: { projectId: command.project.projectId, hostId: command.hostId },
						}),
					)
					return missingRepositorySources(data.sources).length > 0
				} catch {
					// The create procedure repeats this check authoritatively. A failed preflight
					// should not turn a transient read failure into a permanent launch blocker.
					return false
				}
			},
			onRepositorySourcesRequired: setPendingRepositorySourceCommand,
			tasks: {
				launchDraft: (input) => client.tasks.launchDraft(input),
				createV2: (input) => client.tasks.v2.create(input),
				waitForTask: (_id, transactionId) => confirmTx.tasks(transactionId),
				waitForSession: (_id, transactionId) => confirmTx.sessions(transactionId),
			},
			success: {
				applyOptimisticLaunch: (_command, result, confirmation) => {
					if (result.task && result.firstSession) {
						applyOptimisticTaskDraftLaunch({
							tasksCollection,
							sessionsCollection,
							eventsCollection,
							task: result.task,
							firstSession: result.firstSession,
							confirmation,
						})
					}
				},
				rememberLaunch: (command) => rememberSuccessfulLaunch(command, setLastUsedHostId),
				navigate: (target) => navigate(target),
			},
		}),
		[
			api,
			client,
			confirmTx.sessions,
			confirmTx.tasks,
			draftLifecycle,
			eventsCollection,
			navigate,
			setLastUsedHostId,
			sessionsCollection,
			tanstackQueryClient,
			tasksCollection,
		],
	)
	const adapter = useLauncherV3LaunchAdapter(dependencies)
	return (
		<>
			<LauncherV3Form
				{...formProps}
				draftController={draftController}
				getPresignedUploadUrl={(input) => client.uploads.v2.getPresignedUrl(input)}
				onSubmit={adapter.onSubmit}
				operations={adapter.operations}
				onBack={() => navigate({ to: '/sessions', search: { tab: 'tasks' } })}
			/>
			{pendingRepositorySourceCommand?.project && (
				<RepositorySourceSetupDialogWired
					key={`${pendingRepositorySourceCommand.project.projectId}:${pendingRepositorySourceCommand.hostId}`}
					project={{
						id: pendingRepositorySourceCommand.project.projectId,
						repositories: pendingRepositorySourceCommand.project.repositories,
					}}
					hostId={pendingRepositorySourceCommand.hostId}
					mode="launch"
					onCancel={() => setPendingRepositorySourceCommand(null)}
					onSaved={async () => {
						const command = pendingRepositorySourceCommand
						setPendingRepositorySourceCommand(null)
						await adapter.onSubmit(command)
					}}
				/>
			)}
		</>
	)
}
