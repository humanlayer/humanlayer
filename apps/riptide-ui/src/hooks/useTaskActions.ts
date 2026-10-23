import { createTaskActions } from '@/actions/tasks'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useRiptideApi } from '@/orpc/client'

/**
 * Hook to access task mutation actions with optimistic updates.
 * Provides actions like updateTaskName, archiveTask, etc.
 */
export function useTaskActions() {
	const { tasksCollection, sessionsCollection, taskOrganizationAclsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()

	return createTaskActions(
		tasksCollection,
		sessionsCollection,
		taskOrganizationAclsCollection,
		{
			tasks: {
				create: (input) => client.tasks.create(input),
				createDraft: (input) => client.tasks.createDraft(input),
				update: (input) => client.tasks.update(input),
				archive: (input) => client.tasks.archive(input),
				reassignOwner: (input) => client.tasks.reassignOwner(input),
			},
		},
		confirmTx.tasks,
		confirmTx.sessions,
		{
			tasks: confirmTx.tasks,
			sessions: confirmTx.sessions,
			conversationEvents: confirmTx.conversationEvents,
			approvals: confirmTx.approvals,
			queuedMessages: confirmTx.queuedMessages,
			artifacts: confirmTx.artifacts,
			artifactsMetadata: confirmTx.artifactsMetadata,
			artifactComments: confirmTx.artifactComments,
			diffComments: confirmTx.diffComments,
			taskUserAcls: confirmTx.taskUserAcls,
			taskOrganizationAcls: confirmTx.taskOrganizationAcls,
		},
	)
}
