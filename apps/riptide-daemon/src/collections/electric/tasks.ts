import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { createElectricSyncErrorHandler } from '@humanlayer/sync'
import { BasicIndex, createCollection, createLiveQueryCollection, eq, inArray } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import { DEFAULT_BACKOFF_OPTIONS } from '../types'
import type { SessionsCollection } from './sessions'
import type { WorkspaceSetupCollection } from './workspace-setup'

export type TasksCollection = ReturnType<typeof createTasksCollection>

/**
 * Create a new tasks collection with the given sync origin and identity.
 * Returns the collection synchronously. Rows load on demand; use `loadHostTasks` to load this host's tasks.
 *
 * @param syncOrigin - The Electric sync origin URL
 * @param token - The daemon authentication token
 */
export function createTasksCollection(syncOrigin: string, token: string) {
	logger.debug('Initializing tasks electric collection')
	const tasksElectricCollection = createCollection(
		electricCollectionOptions({
			schema: taskSelectSchema,
			shapeOptions: {
				url: `${syncOrigin}/v1/tasks`,
				subsetMethod: 'POST',
				headers: {
					'x-daemon-authorization': token,
				},
				onError: createElectricSyncErrorHandler({
					collectionName: 'tasks',
					shouldRetryOnFailure: true,
					logger,
					captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
				}),
				backoffOptions: DEFAULT_BACKOFF_OPTIONS,
			},
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
	logger.debug('Tasks electric collection initialized')

	return tasksElectricCollection
}

export interface HostTaskSources {
	readonly tasks: TasksCollection
	readonly sessions: SessionsCollection
	readonly workspaceSetup: WorkspaceSetupCollection
}

export interface HostTasks {
	readonly release: () => Promise<void>
}

export async function loadHostTasks(sources: HostTaskSources): Promise<HostTasks> {
	const taskLinks = [
		createLiveQueryCollection((q) =>
			q
				.from({ session: sources.sessions })
				.leftJoin({ task: sources.tasks }, ({ session, task }) => eq(session.task_id, task.id))
				.select(({ session }) => ({ id: session.id, taskId: session.task_id })),
		),
		createLiveQueryCollection((q) =>
			q
				.from({ workspaceSetup: sources.workspaceSetup })
				.leftJoin({ task: sources.tasks }, ({ workspaceSetup, task }) => eq(workspaceSetup.task_id, task.id))
				.select(({ workspaceSetup }) => ({ id: workspaceSetup.id, taskId: workspaceSetup.task_id })),
		),
	]
	const subscriptions = taskLinks.map((links) => links.subscribeChanges(() => undefined))
	const links = await Promise.all(taskLinks.map((query) => query.toArrayWhenReady()))
	const taskIds = [...new Set(links.flat().flatMap((link) => (link.taskId == null ? [] : [link.taskId])))]
	// Readiness of a live query does not cover the lazy side of its joins, only its own sources.
	const initialTasks = createLiveQueryCollection((q) =>
		q.from({ task: sources.tasks }).where(({ task }) => inArray(task.id, taskIds)),
	)
	await initialTasks.toArrayWhenReady()
	logger.debug({ count: sources.tasks.size, hostTaskCount: taskIds.length }, 'Host tasks loaded')
	return {
		release: async () => {
			for (const subscription of subscriptions) subscription.unsubscribe()
			await Promise.all([...taskLinks, initialTasks].map((query) => query.cleanup()))
		},
	}
}
