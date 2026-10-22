import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { createElectricCollection } from '@humanlayer/sync'

import { Sentry } from '@/instrument'
import logger from '@/logger'

export type WorkspaceSetupCollection = ReturnType<typeof createWorkspaceSetupCollection>
export function createWorkspaceSetupCollection(syncOrigin: string, token: string) {
	return createElectricCollection({
		schema: taskWorkspaceSetupForHostSelectSchema,
		collectionName: 'workspaceSetup',
		syncOrigin,
		syncVersion: 2,
		routePath: '/daemon/workspace-setup',
		headers: { 'x-daemon-authorization': token },
		shouldRetryOnFailure: true,
		logger,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		getKey: (item) => item.id,
	})
}

export async function awaitWorkspaceSetupCollectionReady(collection: WorkspaceSetupCollection): Promise<void> {
	collection.subscribeChanges(() => {}, { includeInitialState: true })
	await new Promise<void>((resolve) => collection.onFirstReady(resolve))
	logger.debug({ count: collection.toArray.length }, 'Workspace setup collection ready')
}
