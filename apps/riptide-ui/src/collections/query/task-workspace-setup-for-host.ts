import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const builder = createBrowserQueryCollection({
	collectionName: 'workspaceSetup',
	rowSchema: taskWorkspaceSetupForHostSelectSchema,
	procedure: (client) => (client as RiptideApiClient).sync.v2.taskWorkspaceSetupForHost,
	bigIntFields: ['created_at', 'updated_at'],
})
export const createQueryTaskWorkspaceSetupForHostCollection = builder.create
export type QueryTaskWorkspaceSetupForHostCollection = ReturnType<typeof createQueryTaskWorkspaceSetupForHostCollection>
export const getQueryTaskWorkspaceSetupForHostCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	builder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})
export const destroyQueryTaskWorkspaceSetupForHostCollection = builder.destroy
