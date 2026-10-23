import { useMemo } from 'react'

import { createSessionActions, createSessionV2Actions, type OptimisticLaunchSessionParams } from '@/actions/sessions'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

import { useRepositorySourceLaunchGuard } from './useRepositorySourceLaunchGuard'

/**
 * Hook to access session mutation actions with optimistic updates.
 * Provides actions like updateSessionModel, updateSessionTitle, etc.
 */
export function useSessionActions() {
	const { sessionsCollection, eventsCollection, tasksCollection, queuedMessagesCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	const { dbOrganizationId, userId: dbUserId } = useUserInfo()
	const { guardProjectSessionLaunch, repositorySourceSetupDialog } = useRepositorySourceLaunchGuard()

	const actions = useMemo(
		() => ({
			...createSessionActions(
				sessionsCollection,
				{
					sessions: {
						update: (input) => client.sessions.update(input),
						continue: (input) => client.sessions.continue(input),
						interrupt: (input) => client.sessions.interrupt(input),
					},
				},
				dbUserId ?? '',
				dbOrganizationId ?? '',
				eventsCollection,
				tasksCollection,
				{
					launch: (input) => client.sessions.launch(input),
					create: (input) => client.sessions.create(input),
					fork: (input) => client.sessions.v2.fork(input),
					handoff: (input) => client.sessions.handoff(input, { context: { silent: true } }),
					createV2: (input) => client.sessions.v2.create(input),
				},
				confirmTx.sessions,
			),
			...createSessionV2Actions(
				sessionsCollection,
				eventsCollection,
				queuedMessagesCollection,
				{
					continue: (input) => client.sessions.v2.continue(input),
					updateQueuedMessage: (input) => client.sessions.queuedMessages.update(input),
					deleteQueuedMessage: (input) => client.sessions.queuedMessages.delete(input),
					requestSendQueuedMessageNow: (input) => client.sessions.queuedMessages.sendNow(input),
				},
				dbUserId ?? '',
				dbOrganizationId ?? '',
				confirmTx.sessions,
				confirmTx.queuedMessages,
			),
		}),
		[
			sessionsCollection,
			client,
			dbUserId,
			dbOrganizationId,
			eventsCollection,
			tasksCollection,
			confirmTx.sessions,
			queuedMessagesCollection,
			confirmTx.queuedMessages,
		],
	)

	return useMemo(
		() => ({
			...actions,
			/**
			 * Project-backed creation entry point. Callers must render repositorySourceSetupDialog
			 * from the same hook instance so missing source preferences can resume this exact input.
			 */
			launchProjectSession: async (
				params: OptimisticLaunchSessionParams & { taskId: string; workspaceId: string },
			) =>
				guardProjectSessionLaunch({
					taskId: params.taskId,
					hostId: params.hostId,
					launch: async () => {
						const transaction = actions.launchSession(params)
						await transaction.isPersisted.promise
					},
				}),
			repositorySourceSetupDialog,
		}),
		[actions, guardProjectSessionLaunch, repositorySourceSetupDialog],
	)
}
