import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const builder = createBrowserElectricCollection({
	schema: taskWorkspaceSetupForHostSelectSchema,
	routePath: '/task-workspace-setup-for-host',
	collectionName: 'workspaceSetup',
})
export const createTaskWorkspaceSetupForHostCollection = builder.create
export type TaskWorkspaceSetupForHostCollection = ReturnType<typeof createTaskWorkspaceSetupForHostCollection>
export const getTaskWorkspaceSetupForHostCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	builder.get(
		userId,
		organizationId,
		{
			syncOrigin: VITE_PUBLIC_SYNC_ORIGIN,
			tokenFetcher,
			shouldRetryOnFailure: !isLoading,
			tracker,
			syncVersion,
			logger,
			captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		},
		isLoading,
	)
