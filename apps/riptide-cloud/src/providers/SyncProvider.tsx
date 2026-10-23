import { AWAIT_TX_TIMEOUT, CollectionHealthTracker, type SyncVersion } from '@humanlayer/sync'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { useRiptideApi } from '@/api/client'
import { getArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { getArtifactsCollection } from '@/collections/electric/artifacts'
import { getArtifactsMetadataCollection } from '@/collections/electric/artifacts-metadata'
import { getSessionsCollection } from '@/collections/electric/sessions'
import { getTasksCollection } from '@/collections/electric/tasks'
import {
	destroyQueryArtifactCommentsCollection,
	getQueryArtifactCommentsCollection,
	type QueryArtifactCommentsCollection,
} from '@/collections/query/artifact-comments'
import {
	destroyQueryArtifactsCollection,
	getQueryArtifactsCollection,
	type QueryArtifactsCollection,
} from '@/collections/query/artifacts'
import {
	destroyQueryArtifactsMetadataCollection,
	getQueryArtifactsMetadataCollection,
	type QueryArtifactsMetadataCollection,
} from '@/collections/query/artifacts-metadata'
import {
	destroyQuerySessionsCollection,
	getQuerySessionsCollection,
	type QuerySessionsCollection,
} from '@/collections/query/sessions'
import {
	destroyQueryTasksCollection,
	getQueryTasksCollection,
	type QueryTasksCollection,
} from '@/collections/query/tasks'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

// ============================================================================
// Tracker singleton (stable across re-renders)
// ============================================================================

const tracker = new CollectionHealthTracker({
	collections: ['artifactComments', 'artifacts', 'artifactsMetadata', 'sessions', 'tasks'],
})

// ============================================================================
// Context value types
// ============================================================================

export type SyncContextValue = {
	artifactCommentsCollection:
		| ReturnType<typeof getArtifactCommentsCollection>
		| ReturnType<typeof getQueryArtifactCommentsCollection>
	artifactsCollection: ReturnType<typeof getArtifactsCollection> | ReturnType<typeof getQueryArtifactsCollection>
	artifactsMetadataCollection:
		| ReturnType<typeof getArtifactsMetadataCollection>
		| ReturnType<typeof getQueryArtifactsMetadataCollection>
	sessionsCollection: ReturnType<typeof getSessionsCollection> | ReturnType<typeof getQuerySessionsCollection>
	tasksCollection: ReturnType<typeof getTasksCollection> | ReturnType<typeof getQueryTasksCollection>
}

/** Per-collection confirmTx function: awaits sync after a write operation. */
export type ConfirmTxFn = (txId: string | number) => Promise<void>

export type SyncInternalContextValue = {
	tracker: CollectionHealthTracker
	modes: Record<string, 'electric' | 'query'>
	confirmTx: {
		sessions: ConfirmTxFn
		tasks: ConfirmTxFn
		artifactComments: ConfirmTxFn
		artifacts: ConfirmTxFn
		artifactsMetadata: ConfirmTxFn
	}
}

// ============================================================================
// Contexts
// ============================================================================

export const SyncContext = createContext<SyncContextValue | null>(null)
export const SyncInternalContext = createContext<SyncInternalContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export const SyncProvider = ({ children }: { children: ReactNode }) => {
	const syncVersion: SyncVersion = 2
	return <SyncProviderInner syncVersion={syncVersion}>{children}</SyncProviderInner>
}

const SyncProviderInner = ({ syncVersion, children }: { syncVersion: SyncVersion; children: ReactNode }) => {
	const { getAccessToken, user, organizationId, isLoading } = useAuth()
	const queryClient = useQueryClient()
	const fullApiClient = useRiptideApi()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)

	// Wire settings store force mode to tracker (inline during render — tracker is a stable module-level singleton)
	tracker.forceAllMode(syncForceMode)

	// Subscribe to tracker mode changes so we re-render when any collection's mode changes
	const modes = useSyncExternalStore(
		(callback) => tracker.onChange((_name, _mode) => callback()),
		() => tracker.getAllModes(),
	)

	// ---- Electric collections (all 4) ----

	const artifactsElectric = useMemo(() => {
		return getArtifactsCollection(
			user?.id ?? null,
			organizationId ?? null,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const artifactCommentsElectric = useMemo(() => {
		return getArtifactCommentsCollection(
			user?.id ?? null,
			organizationId ?? null,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const artifactsMetadataElectric = useMemo(() => {
		return getArtifactsMetadataCollection(
			user?.id ?? null,
			organizationId ?? null,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const sessionsElectric = useMemo(() => {
		return getSessionsCollection(
			user?.id ?? null,
			organizationId ?? null,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const tasksElectric = useMemo(() => {
		return getTasksCollection(
			user?.id ?? null,
			organizationId ?? null,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	// ---- Query collection refs (lazily created when electric degrades) ----

	const artifactsQueryRef = useRef<QueryArtifactsCollection | null>(null)
	const artifactCommentsQueryRef = useRef<QueryArtifactCommentsCollection | null>(null)
	const artifactsMetadataQueryRef = useRef<QueryArtifactsMetadataCollection | null>(null)
	const sessionsQueryRef = useRef<QuerySessionsCollection | null>(null)
	const tasksQueryRef = useRef<QueryTasksCollection | null>(null)

	// Stable identity values for use in closures
	const userId = user?.id ?? null
	const orgId = organizationId ?? null

	// ---- Lazy creation/destruction of query collections on mode change ----

	useEffect(() => {
		const ensureQueryCollection = (collectionName: string) => {
			switch (collectionName) {
				case 'artifacts':
					if (!artifactsQueryRef.current) {
						artifactsQueryRef.current = getQueryArtifactsCollection(
							userId,
							orgId,
							fullApiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'artifactComments':
					if (!artifactCommentsQueryRef.current) {
						artifactCommentsQueryRef.current = getQueryArtifactCommentsCollection(
							userId,
							orgId,
							fullApiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'artifactsMetadata':
					if (!artifactsMetadataQueryRef.current) {
						artifactsMetadataQueryRef.current = getQueryArtifactsMetadataCollection(
							userId,
							orgId,
							fullApiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'sessions':
					if (!sessionsQueryRef.current) {
						sessionsQueryRef.current = getQuerySessionsCollection(
							userId,
							orgId,
							fullApiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'tasks':
					if (!tasksQueryRef.current) {
						tasksQueryRef.current = getQueryTasksCollection(
							userId,
							orgId,
							fullApiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
			}
		}

		const destroyQueryCollection = (collectionName: string) => {
			switch (collectionName) {
				case 'artifacts':
					if (artifactsQueryRef.current) {
						destroyQueryArtifactsCollection(userId, orgId, syncVersion)
						artifactsQueryRef.current = null
					}
					break
				case 'artifactComments':
					if (artifactCommentsQueryRef.current) {
						destroyQueryArtifactCommentsCollection(userId, orgId, syncVersion)
						artifactCommentsQueryRef.current = null
					}
					break
				case 'artifactsMetadata':
					if (artifactsMetadataQueryRef.current) {
						destroyQueryArtifactsMetadataCollection(userId, orgId, syncVersion)
						artifactsMetadataQueryRef.current = null
					}
					break
				case 'sessions':
					if (sessionsQueryRef.current) {
						destroyQuerySessionsCollection(userId, orgId, syncVersion)
						sessionsQueryRef.current = null
					}
					break
				case 'tasks':
					if (tasksQueryRef.current) {
						destroyQueryTasksCollection(userId, orgId, syncVersion)
						tasksQueryRef.current = null
					}
					break
			}
		}

		// Initialize: create query collections for any collection already in query mode
		// (e.g. if electric was already degraded before this effect ran)
		const currentModes = tracker.getAllModes()
		for (const [collectionName, currentMode] of Object.entries(currentModes)) {
			if (currentMode === 'query') {
				ensureQueryCollection(collectionName)
			}
		}

		// Subscribe to future mode changes
		const unsubscribeModeListener = tracker.onChange((collectionName, newMode) => {
			if (newMode === 'query') {
				ensureQueryCollection(collectionName)
			} else {
				destroyQueryCollection(collectionName)
			}
		})

		// Cleanup: unsubscribe and destroy all active query collections
		return () => {
			unsubscribeModeListener()
			for (const collectionName of Object.keys(currentModes)) {
				destroyQueryCollection(collectionName)
			}
		}
	}, [userId, orgId, fullApiClient, queryClient, getAccessToken, isLoading, syncVersion])

	// ---- Swap each collection based on current mode ----
	// Refs are populated synchronously in the tracker.onChange callback before React re-renders.
	// Defensive fallback to electric collection if the ref is null (e.g. on first render
	// before the useEffect has run but tracker is already in query mode).

	const artifactsCollection =
		modes.artifacts === 'query' ? (artifactsQueryRef.current ?? artifactsElectric) : artifactsElectric
	const artifactCommentsCollection =
		modes.artifactComments === 'query'
			? (artifactCommentsQueryRef.current ?? artifactCommentsElectric)
			: artifactCommentsElectric
	const artifactsMetadataCollection =
		modes.artifactsMetadata === 'query'
			? (artifactsMetadataQueryRef.current ?? artifactsMetadataElectric)
			: artifactsMetadataElectric
	const sessionsCollection =
		modes.sessions === 'query' ? (sessionsQueryRef.current ?? sessionsElectric) : sessionsElectric
	const tasksCollection = modes.tasks === 'query' ? (tasksQueryRef.current ?? tasksElectric) : tasksElectric

	// ---- confirmTx: per-collection post-write sync confirmation ----
	// Electric mode: wait for the transaction to sync back via awaitTxId
	// Query mode: trigger an immediate refetch so the collection reflects the latest state
	// Refs are read at call time (not at closure creation time), so they always reflect current state.

	const confirmTx = useMemo(
		() => ({
			sessions: async (txId: string | number): Promise<void> => {
				if (modes.sessions === 'query' && sessionsQueryRef.current) {
					await sessionsQueryRef.current.utils.refetch()
				} else {
					await sessionsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			tasks: async (txId: string | number): Promise<void> => {
				if (modes.tasks === 'query' && tasksQueryRef.current) {
					await tasksQueryRef.current.utils.refetch()
				} else {
					await tasksElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifacts: async (txId: string | number): Promise<void> => {
				if (modes.artifacts === 'query' && artifactsQueryRef.current) {
					await artifactsQueryRef.current.utils.refetch()
				} else {
					await artifactsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifactComments: async (txId: string | number): Promise<void> => {
				if (modes.artifactComments === 'query' && artifactCommentsQueryRef.current) {
					await artifactCommentsQueryRef.current.utils.refetch()
				} else {
					await artifactCommentsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifactsMetadata: async (txId: string | number): Promise<void> => {
				if (modes.artifactsMetadata === 'query' && artifactsMetadataQueryRef.current) {
					await artifactsMetadataQueryRef.current.utils.refetch()
				} else {
					await artifactsMetadataElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
		}),
		[
			modes.sessions,
			modes.tasks,
			modes.artifacts,
			modes.artifactComments,
			modes.artifactsMetadata,
			sessionsElectric,
			tasksElectric,
			artifactsElectric,
			artifactCommentsElectric,
			artifactsMetadataElectric,
		],
	)

	return (
		<SyncInternalContext.Provider value={{ tracker, modes, confirmTx }}>
			<SyncContext.Provider
				value={{
					artifactCommentsCollection,
					artifactsCollection,
					artifactsMetadataCollection,
					sessionsCollection,
					tasksCollection,
				}}
			>
				{children}
			</SyncContext.Provider>
		</SyncInternalContext.Provider>
	)
}

// ============================================================================
// Hooks
// ============================================================================

export const useSync = () => {
	const context = useContext(SyncContext)
	if (!context) throw new Error('useSync must be used within a SyncProvider')
	return context
}

export const useSyncInternal = () => {
	const context = useContext(SyncInternalContext)
	if (!context) throw new Error('useSyncInternal must be used within a SyncProvider')
	return context
}
