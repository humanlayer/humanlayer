import { and, createLiveQueryCollection, eq } from '@tanstack/react-db'

import { getApprovalsCollection } from '@/collections/electric/approvals'
import { getEventsCollection } from '@/collections/electric/conversation-events'
import { getSessionsCollection } from '@/collections/electric/sessions'

import { tracker } from './tracker'

export interface PreloadServiceDeps {
	userId: string
	organizationId: string
	tokenFetcher: () => Promise<string>
}

// GC time for preloaded collections - short since they're only needed until navigation completes
// TODO: increase back to 15_000 after testing
const PRELOAD_GC_TIME_MS = 5_000

export function createPreloadService(deps: PreloadServiceDeps) {
	const { userId, organizationId, tokenFetcher } = deps

	// Track active preload collections to avoid duplicates
	// Key -> { collection, timeoutId }
	const activeCollections = new Map<
		string,
		{ collection: ReturnType<typeof createLiveQueryCollection>; timeoutId: ReturnType<typeof setTimeout> }
	>()

	/** Create collection if not exists, skip if already active */
	function getOrCreateCollection(key: string, factory: () => ReturnType<typeof createLiveQueryCollection>): boolean {
		if (activeCollections.has(key)) {
			return false
		}

		const collection = factory()

		// IMPORTANT: startSync: true does NOT count as a subscriber, so the collection's
		// internal gcTime timer will NEVER start (it only starts when a subscriber unsubscribes).
		// We must explicitly call collection.cleanup() to release resources.
		const timeoutId = setTimeout(() => {
			void collection.cleanup()
			activeCollections.delete(key)
		}, PRELOAD_GC_TIME_MS)

		activeCollections.set(key, { collection, timeoutId })

		return true
	}

	return {
		/**
		 * Preload sessions for a task detail page.
		 * Creates a live query collection that immediately syncs non-archived sessions filtered by task_id.
		 * Skips creation if a collection for this task already exists.
		 * @param isArchived - If true, skip preloading (archived tasks don't need preload)
		 */
		preloadTaskDetail: (taskId: string, isArchived?: boolean) => {
			if (isArchived) {
				return
			}
			const key = `sessions:task:${taskId}`

			getOrCreateCollection(key, () => {
				const sessionsCollection = getSessionsCollection(userId, organizationId, tokenFetcher, false, tracker)
				return createLiveQueryCollection({
					query: (q) =>
						q
							.from({ sessions: sessionsCollection })
							.where(({ sessions }) => and(eq(sessions.task_id, taskId), eq(sessions.archived, false))),
					startSync: true,
					gcTime: PRELOAD_GC_TIME_MS,
				})
			})
		},

		/**
		 * Preload events and approvals for a session detail page.
		 * Creates live query collections that immediately sync data filtered by session_id.
		 * Skips creation if collections for this session already exist.
		 * @param isArchived - If true, skip preloading (archived sessions don't need preload)
		 */
		preloadSessionDetail: (sessionId: string, isArchived?: boolean) => {
			if (isArchived) {
				return
			}
			const eventsKey = `events:session:${sessionId}`
			const approvalsKey = `approvals:session:${sessionId}`

			getOrCreateCollection(eventsKey, () => {
				const eventsCollection = getEventsCollection(userId, organizationId, tokenFetcher, false, tracker)
				return createLiveQueryCollection({
					query: (q) =>
						q.from({ events: eventsCollection }).where(({ events }) => eq(events.session_id, sessionId)),
					startSync: true,
					gcTime: PRELOAD_GC_TIME_MS,
				})
			})

			getOrCreateCollection(approvalsKey, () => {
				const approvalsCollection = getApprovalsCollection(userId, organizationId, tokenFetcher, false, tracker)
				return createLiveQueryCollection({
					query: (q) =>
						q
							.from({ approvals: approvalsCollection })
							.where(({ approvals }) => eq(approvals.session_id, sessionId)),
					startSync: true,
					gcTime: PRELOAD_GC_TIME_MS,
				})
			})
		},
	}
}

export type PreloadService = ReturnType<typeof createPreloadService>
