import {
	AccessTokenUnavailableError,
	AWAIT_TX_TIMEOUT,
	type CollectionHealthTracker,
	type SyncVersion,
} from '@humanlayer/sync'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import {
	type MutableRefObject,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from 'react'

import { getAgentSlashCommandsCollection } from '@/collections/electric/agent-slash-commands'
import { getApprovalsCollection } from '@/collections/electric/approvals'
import { getArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { getArtifactsCollection } from '@/collections/electric/artifacts'
import { getArtifactsMetadataCollection } from '@/collections/electric/artifacts-metadata'
import { getEventsCollection } from '@/collections/electric/conversation-events'
import { getDiffCommentsCollection } from '@/collections/electric/diff-comments'
import { getOnlineHostsCollection } from '@/collections/electric/online-hosts'
import { getProviderLoginRequestsCollection } from '@/collections/electric/provider-login-requests'
import { getQueuedMessagesCollection } from '@/collections/electric/queued-messages'
import { getSessionsCollection } from '@/collections/electric/sessions'
import { getTaskOrganizationAclsCollection } from '@/collections/electric/task-organization-acls'
import { getTaskUserAclsCollection } from '@/collections/electric/task-user-acls'
import { getTaskUserSettingsCollection } from '@/collections/electric/task-user-settings'
import { getTaskWorkspaceSetupForHostCollection } from '@/collections/electric/task-workspace-setup-for-host'
import { getTasksCollection } from '@/collections/electric/tasks'
import {
	destroyQueryApprovalsCollection,
	getQueryApprovalsCollection,
	type QueryApprovalsCollection,
} from '@/collections/query/approvals'
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
	destroyQueryEventsCollection,
	getQueryEventsCollection,
	type QueryEventsCollection,
} from '@/collections/query/conversation-events'
import {
	destroyQueryDiffCommentsCollection,
	getQueryDiffCommentsCollection,
	type QueryDiffCommentsCollection,
} from '@/collections/query/diff-comments'
import {
	destroyQueryOnlineHostsCollection,
	getQueryOnlineHostsCollection,
	type QueryOnlineHostsCollection,
} from '@/collections/query/online-hosts'
import {
	destroyQueryProviderLoginRequestsCollection,
	getQueryProviderLoginRequestsCollection,
	type QueryProviderLoginRequestsCollection,
} from '@/collections/query/provider-login-requests'
import {
	destroyQueryQueuedMessagesCollection,
	getQueryQueuedMessagesCollection,
	type QueryQueuedMessagesCollection,
} from '@/collections/query/queued-messages'
import {
	destroyQuerySessionsCollection,
	getQuerySessionsCollection,
	type QuerySessionsCollection,
} from '@/collections/query/sessions'
import {
	destroyQueryTaskOrganizationAclsCollection,
	getQueryTaskOrganizationAclsCollection,
	type QueryTaskOrganizationAclsCollection,
} from '@/collections/query/task-organization-acls'
import {
	destroyQueryTaskUserAclsCollection,
	getQueryTaskUserAclsCollection,
	type QueryTaskUserAclsCollection,
} from '@/collections/query/task-user-acls'
import {
	destroyQueryTaskUserSettingsCollection,
	getQueryTaskUserSettingsCollection,
	type QueryTaskUserSettingsCollection,
} from '@/collections/query/task-user-settings'
import {
	destroyQueryTaskWorkspaceSetupForHostCollection,
	getQueryTaskWorkspaceSetupForHostCollection,
	type QueryTaskWorkspaceSetupForHostCollection,
} from '@/collections/query/task-workspace-setup-for-host'
import {
	destroyQueryTasksCollection,
	getQueryTasksCollection,
	type QueryTasksCollection,
} from '@/collections/query/tasks'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useSyncAuthReady } from '@/hooks/use-sync-auth-ready'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useRiptideApi } from '@/orpc/client'
import { tracker } from '@/services/tracker'

import { SyncContext, SyncInternalContext } from './SyncContext'

const QUERY_COLLECTION_CLEANUP_DELAY_MS = 1_000

function deferredDestroyQueryCollection(
	ref: MutableRefObject<unknown>,
	destroyFn: () => void,
	queryClient: {
		cancelQueries: (opts: { queryKey: string[] }) => void
		removeQueries: (opts: { queryKey: string[] }) => void
	},
	collectionName: string,
): void {
	if (!ref.current) return
	ref.current = null
	setTimeout(() => {
		destroyFn()
		queryClient.cancelQueries({ queryKey: ['sync', collectionName] })
		queryClient.removeQueries({ queryKey: ['sync', collectionName] })
	}, QUERY_COLLECTION_CLEANUP_DELAY_MS)
}

// ============================================================================
// Context value types
//
// Two separate contexts exist to separate public from internal concerns:
//
// SyncContext (outer) — the public API for UI components.
//   Exposes the active collection for each table (electric or query-backed).
//   Components use `useSync()` to read/query data without caring which sync
//   engine is currently active.
//
// SyncInternalContext (inner) — plumbing for the sync infrastructure.
//   Exposes the CollectionHealthTracker (controls electric↔query failover),
//   per-collection mode map, and `confirmTx` helpers (await electric txId or
//   trigger a query refetch after writes). Only consumed by write-path code
//   (actions, mutations) and sync-status UI (settings, footer indicators).
//
// Splitting them avoids re-rendering every collection consumer when only the
// internal mode/tracker state changes, and keeps the public API surface small.
// ============================================================================

export type SyncContextValue = {
	sessionsCollection: ReturnType<typeof getSessionsCollection> | ReturnType<typeof getQuerySessionsCollection>
	tasksCollection: ReturnType<typeof getTasksCollection> | ReturnType<typeof getQueryTasksCollection>
	eventsCollection: ReturnType<typeof getEventsCollection> | ReturnType<typeof getQueryEventsCollection>
	onlineHostsCollection:
		| ReturnType<typeof getOnlineHostsCollection>
		| ReturnType<typeof getQueryOnlineHostsCollection>
	approvalsCollection: ReturnType<typeof getApprovalsCollection> | ReturnType<typeof getQueryApprovalsCollection>
	artifactCommentsCollection:
		| ReturnType<typeof getArtifactCommentsCollection>
		| ReturnType<typeof getQueryArtifactCommentsCollection>
	diffCommentsCollection:
		| ReturnType<typeof getDiffCommentsCollection>
		| ReturnType<typeof getQueryDiffCommentsCollection>
	artifactsCollection: ReturnType<typeof getArtifactsCollection> | ReturnType<typeof getQueryArtifactsCollection>
	artifactsMetadataCollection:
		| ReturnType<typeof getArtifactsMetadataCollection>
		| ReturnType<typeof getQueryArtifactsMetadataCollection>
	taskOrganizationAclsCollection:
		| ReturnType<typeof getTaskOrganizationAclsCollection>
		| ReturnType<typeof getQueryTaskOrganizationAclsCollection>
	taskUserAclsCollection:
		| ReturnType<typeof getTaskUserAclsCollection>
		| ReturnType<typeof getQueryTaskUserAclsCollection>
	taskUserSettingsCollection:
		| ReturnType<typeof getTaskUserSettingsCollection>
		| ReturnType<typeof getQueryTaskUserSettingsCollection>
	taskWorkspaceSetupForHostCollection:
		| ReturnType<typeof getTaskWorkspaceSetupForHostCollection>
		| ReturnType<typeof getQueryTaskWorkspaceSetupForHostCollection>
	queuedMessagesCollection: ReturnType<typeof getQueuedMessagesCollection> | QueryQueuedMessagesCollection
	agentSlashCommandsCollection: ReturnType<typeof getAgentSlashCommandsCollection>
	providerLoginRequestsCollection:
		| ReturnType<typeof getProviderLoginRequestsCollection>
		| ReturnType<typeof getQueryProviderLoginRequestsCollection>
}

/** Per-collection confirmTx function: awaits sync after a write operation. */
export type ConfirmTxFn = (txId: string | number) => Promise<void>

export type SyncInternalContextValue = {
	tracker: CollectionHealthTracker
	modes: Record<string, 'electric' | 'query'>
	/**
	 * True once auth has resolved *and* an access token was actually obtained, so
	 * the collections can sync. Until then a collection's `isReady` means nothing:
	 * Electric marks a shape ready on any error, including the token being absent,
	 * which leaves the collection ready and empty. Pages that would otherwise
	 * report "not found" must wait for this.
	 */
	syncAuthReady: boolean
	confirmTx: {
		sessions: ConfirmTxFn
		tasks: ConfirmTxFn
		conversationEvents: ConfirmTxFn
		approvals: ConfirmTxFn
		artifactComments: ConfirmTxFn
		diffComments: ConfirmTxFn
		artifacts: ConfirmTxFn
		artifactsMetadata: ConfirmTxFn
		taskOrganizationAcls: ConfirmTxFn
		taskUserAcls: ConfirmTxFn
		taskUserSettings: ConfirmTxFn
		workspaceSetup: ConfirmTxFn
		queuedMessages: ConfirmTxFn
		providerLoginRequests: ConfirmTxFn
	}
}

// ============================================================================
// Provider
// ============================================================================

export const SyncProvider = ({ children }: { children: ReactNode }) => {
	const { getAccessToken: getAuthKitAccessToken, user, organizationId, isLoading } = useAuth()
	const queryClient = useQueryClient()
	const { client: apiClient } = useRiptideApi()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)
	const syncVersion: SyncVersion = 2
	const getAccessToken = useCallback(() => {
		if (isLoading || !user || !organizationId) {
			return Promise.reject(new AccessTokenUnavailableError('Authentication is not ready'))
		}
		return getAuthKitAccessToken()
	}, [getAuthKitAccessToken, isLoading, organizationId, user])

	// Enable Electric SQL debug mode for troubleshooting sync issues
	useMountEffect(() => {
		localStorage.setItem('electric.debug', 'true')
	})

	// Suppress AccessTokenUnavailableError from showing as "Uncaught (in promise)"
	// in the console. These are expected during early renders before auth is ready
	// and are handled by Electric's onError callback via createElectricSyncErrorHandler.
	useMountEffect(() => {
		const handler = (event: PromiseRejectionEvent) => {
			if (event.reason instanceof AccessTokenUnavailableError) {
				event.preventDefault()
			}
		}
		window.addEventListener('unhandledrejection', handler)
		return () => window.removeEventListener('unhandledrejection', handler)
	})

	// Wire settings store force mode to tracker
	useEffect(() => {
		tracker.forceAllMode(syncForceMode)
	}, [syncForceMode])

	useEffect(() => {
		if (organizationId) {
			void queryClient.resetQueries()
		}
	}, [organizationId])

	// Subscribe to tracker mode changes so we re-render when mode changes
	const modes = useSyncExternalStore(
		(callback) => tracker.onChange((_name, _mode) => callback()),
		() => tracker.getAllModes(),
	)

	// ---- Electric collections ----

	const sessionsElectric = useMemo(() => {
		return getSessionsCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker, syncVersion)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const onlineHostsElectric = useMemo(() => {
		return getOnlineHostsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const agentSlashCommandsElectric = useMemo(() => {
		return getAgentSlashCommandsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const tasksElectric = useMemo(() => {
		return getTasksCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker, syncVersion)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const eventsElectric = useMemo(() => {
		return getEventsCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker, syncVersion)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const approvalsElectric = useMemo(() => {
		return getApprovalsCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker, syncVersion)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const artifactCommentsElectric = useMemo(() => {
		return getArtifactCommentsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const diffCommentsElectric = useMemo(() => {
		return getDiffCommentsCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const artifactsElectric = useMemo(() => {
		return getArtifactsCollection(user?.id ?? null, organizationId, getAccessToken, isLoading, tracker, syncVersion)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const artifactsMetadataElectric = useMemo(() => {
		return getArtifactsMetadataCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const taskOrganizationAclsElectric = useMemo(() => {
		return getTaskOrganizationAclsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const taskUserAclsElectric = useMemo(() => {
		return getTaskUserAclsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const taskUserSettingsElectric = useMemo(() => {
		return getTaskUserSettingsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const taskWorkspaceSetupForHostElectric = useMemo(() => {
		return getTaskWorkspaceSetupForHostCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const queuedMessagesElectric = useMemo(() => {
		return getQueuedMessagesCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	const providerLoginRequestsElectric = useMemo(() => {
		return getProviderLoginRequestsCollection(
			user?.id ?? null,
			organizationId,
			getAccessToken,
			isLoading,
			tracker,
			syncVersion,
		)
	}, [user?.id, organizationId, getAccessToken, isLoading, syncVersion])

	// Keeping degraded Electric collections alive so they can recover (CORE-1326) is handled
	// inside the collection builder (`attachElectricKeepAlive`), so it needs no wiring here.

	// ---- Query collection refs (lazily created when electric degrades) ----

	const sessionsQueryRef = useRef<QuerySessionsCollection | null>(null)
	const onlineHostsQueryRef = useRef<QueryOnlineHostsCollection | null>(null)
	const tasksQueryRef = useRef<QueryTasksCollection | null>(null)
	const eventsQueryRef = useRef<QueryEventsCollection | null>(null)
	const approvalsQueryRef = useRef<QueryApprovalsCollection | null>(null)
	const artifactCommentsQueryRef = useRef<QueryArtifactCommentsCollection | null>(null)
	const diffCommentsQueryRef = useRef<QueryDiffCommentsCollection | null>(null)
	const artifactsQueryRef = useRef<QueryArtifactsCollection | null>(null)
	const artifactsMetadataQueryRef = useRef<QueryArtifactsMetadataCollection | null>(null)
	const taskOrganizationAclsQueryRef = useRef<QueryTaskOrganizationAclsCollection | null>(null)
	const taskUserAclsQueryRef = useRef<QueryTaskUserAclsCollection | null>(null)
	const taskUserSettingsQueryRef = useRef<QueryTaskUserSettingsCollection | null>(null)
	const taskWorkspaceSetupForHostQueryRef = useRef<QueryTaskWorkspaceSetupForHostCollection | null>(null)
	const queuedMessagesQueryRef = useRef<QueryQueuedMessagesCollection | null>(null)
	const providerLoginRequestsQueryRef = useRef<QueryProviderLoginRequestsCollection | null>(null)

	// Stable identity values for use in closures
	const userId = user?.id ?? null
	const orgId = organizationId ?? null
	const syncAuthReady = useSyncAuthReady({
		userId,
		organizationId: orgId,
		isAuthLoading: isLoading,
		getAccessToken,
	})

	// ---- Lazy creation/destruction of query collections on mode change ----

	useEffect(() => {
		const ensureQueryCollection = (collectionName: string) => {
			if (!syncAuthReady) return
			switch (collectionName) {
				case 'sessions':
					if (!sessionsQueryRef.current) {
						sessionsQueryRef.current = getQuerySessionsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'onlineHosts':
					if (!onlineHostsQueryRef.current) {
						onlineHostsQueryRef.current = getQueryOnlineHostsCollection(
							userId,
							orgId,
							apiClient,
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
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'conversationEvents':
					if (!eventsQueryRef.current) {
						eventsQueryRef.current = getQueryEventsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'approvals':
					if (!approvalsQueryRef.current) {
						approvalsQueryRef.current = getQueryApprovalsCollection(
							userId,
							orgId,
							apiClient,
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
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'diffComments':
					if (!diffCommentsQueryRef.current) {
						diffCommentsQueryRef.current = getQueryDiffCommentsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
						)
					}
					break
				case 'artifacts':
					if (!artifactsQueryRef.current) {
						artifactsQueryRef.current = getQueryArtifactsCollection(
							userId,
							orgId,
							apiClient,
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
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'taskOrganizationAcls':
					if (!taskOrganizationAclsQueryRef.current) {
						taskOrganizationAclsQueryRef.current = getQueryTaskOrganizationAclsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'taskUserAcls':
					if (!taskUserAclsQueryRef.current) {
						taskUserAclsQueryRef.current = getQueryTaskUserAclsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'taskUserSettings':
					if (!taskUserSettingsQueryRef.current) {
						taskUserSettingsQueryRef.current = getQueryTaskUserSettingsCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'workspaceSetup':
					if (!taskWorkspaceSetupForHostQueryRef.current) {
						taskWorkspaceSetupForHostQueryRef.current = getQueryTaskWorkspaceSetupForHostCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'queuedMessages':
					if (!queuedMessagesQueryRef.current) {
						queuedMessagesQueryRef.current = getQueryQueuedMessagesCollection(
							userId,
							orgId,
							apiClient,
							tracker,
							queryClient,
							syncVersion,
						)
					}
					break
				case 'providerLoginRequests':
					if (!providerLoginRequestsQueryRef.current) {
						providerLoginRequestsQueryRef.current = getQueryProviderLoginRequestsCollection(
							userId,
							orgId,
							apiClient,
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
				case 'sessions':
					deferredDestroyQueryCollection(
						sessionsQueryRef,
						() => destroyQuerySessionsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'onlineHosts':
					deferredDestroyQueryCollection(
						onlineHostsQueryRef,
						() => destroyQueryOnlineHostsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'tasks':
					deferredDestroyQueryCollection(
						tasksQueryRef,
						() => destroyQueryTasksCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'conversationEvents':
					deferredDestroyQueryCollection(
						eventsQueryRef,
						() => destroyQueryEventsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'approvals':
					deferredDestroyQueryCollection(
						approvalsQueryRef,
						() => destroyQueryApprovalsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'artifactComments':
					deferredDestroyQueryCollection(
						artifactCommentsQueryRef,
						() => destroyQueryArtifactCommentsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'diffComments':
					deferredDestroyQueryCollection(
						diffCommentsQueryRef,
						() => destroyQueryDiffCommentsCollection(userId, orgId),
						queryClient,
						collectionName,
					)
					break
				case 'artifacts':
					deferredDestroyQueryCollection(
						artifactsQueryRef,
						() => destroyQueryArtifactsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'artifactsMetadata':
					deferredDestroyQueryCollection(
						artifactsMetadataQueryRef,
						() => destroyQueryArtifactsMetadataCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'taskOrganizationAcls':
					deferredDestroyQueryCollection(
						taskOrganizationAclsQueryRef,
						() => destroyQueryTaskOrganizationAclsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'taskUserAcls':
					deferredDestroyQueryCollection(
						taskUserAclsQueryRef,
						() => destroyQueryTaskUserAclsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'taskUserSettings':
					deferredDestroyQueryCollection(
						taskUserSettingsQueryRef,
						() => destroyQueryTaskUserSettingsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'workspaceSetup':
					deferredDestroyQueryCollection(
						taskWorkspaceSetupForHostQueryRef,
						() => destroyQueryTaskWorkspaceSetupForHostCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'queuedMessages':
					deferredDestroyQueryCollection(
						queuedMessagesQueryRef,
						() => destroyQueryQueuedMessagesCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
					break
				case 'providerLoginRequests':
					deferredDestroyQueryCollection(
						providerLoginRequestsQueryRef,
						() => destroyQueryProviderLoginRequestsCollection(userId, orgId, syncVersion),
						queryClient,
						collectionName,
					)
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
	}, [userId, orgId, apiClient, queryClient, syncAuthReady, syncVersion])

	// ---- Foreground / reconnect recovery nudge ----
	//
	// On mobile (iOS Safari especially) the tab is suspended when backgrounded: the Electric
	// long-poll socket is dropped and React Query's poll timers are frozen. When the user returns,
	// a collection that had degraded to the query fallback keeps showing stale data until its next
	// poll fires — up to a full refetch interval (4s–10s), and only after the frozen timer thaws.
	//
	// So when the document becomes visible again, or the browser reports it is back online, refetch
	// every currently-degraded (query-mode) collection immediately. Only collections that have
	// actually failed over own a query collection (refs are null otherwise), so healthy Electric
	// collections are untouched. A refetch runs the same query path a normal poll uses, so it records
	// its success/failure on the tracker exactly like any other sync tick.
	//
	// Electric-mode collections are deliberately left alone: their ShapeStream is wrapped in an
	// infinite-backoff retry loop (DEFAULT_BACKOFF_OPTIONS, maxRetries: Infinity) that resumes on its
	// own once the network is back, and the keep-alive holds their subscription open while degraded.
	// We never touch, cleanup, or re-create a ShapeStream here — that is the CORE-1326 failure mode.
	useMountEffect(() => {
		// Late-bound thunks: `.current` is read at nudge time so we always hit the live collection.
		// Typed individually (rather than iterating a heterogeneous ref array) to avoid union widening.
		// Names must match the tracker collection names used by ensureQueryCollection — they key the
		// `['sync', collectionName]` queryKey prefix (same prefix destroyQueryCollection cancels on).
		const refetchers: Array<[string, () => Promise<unknown> | undefined]> = [
			['sessions', () => sessionsQueryRef.current?.utils.refetch()],
			['onlineHosts', () => onlineHostsQueryRef.current?.utils.refetch()],
			['tasks', () => tasksQueryRef.current?.utils.refetch()],
			['conversationEvents', () => eventsQueryRef.current?.utils.refetch()],
			['approvals', () => approvalsQueryRef.current?.utils.refetch()],
			['artifactComments', () => artifactCommentsQueryRef.current?.utils.refetch()],
			['diffComments', () => diffCommentsQueryRef.current?.utils.refetch()],
			['artifacts', () => artifactsQueryRef.current?.utils.refetch()],
			['artifactsMetadata', () => artifactsMetadataQueryRef.current?.utils.refetch()],
			['taskOrganizationAcls', () => taskOrganizationAclsQueryRef.current?.utils.refetch()],
			['taskUserAcls', () => taskUserAclsQueryRef.current?.utils.refetch()],
			['taskUserSettings', () => taskUserSettingsQueryRef.current?.utils.refetch()],
			['workspaceSetup', () => taskWorkspaceSetupForHostQueryRef.current?.utils.refetch()],
			['queuedMessages', () => queuedMessagesQueryRef.current?.utils.refetch()],
			['providerLoginRequests', () => providerLoginRequestsQueryRef.current?.utils.refetch()],
		]

		// `online` and `visibilitychange`→visible typically fire together on device wake — nudge once.
		let lastNudgeAt = 0
		const NUDGE_DEBOUNCE_MS = 2000

		const refetchDegradedCollections = (trigger: 'online' | 'visibilitychange'): void => {
			const now = Date.now()
			if (now - lastNudgeAt < NUDGE_DEBOUNCE_MS) return
			lastNudgeAt = now

			const nudged: string[] = []
			for (const [collectionName, refetch] of refetchers) {
				// Never nudge a collection whose query is already fetching. utils.refetch() defaults to
				// cancelRefetch: true, so an unguarded nudge would silently cancel an in-flight scheduled
				// poll or — worse — a confirmTx refetch, letting confirmTx resolve against stale cached
				// data. An in-flight fetch is already doing exactly what the nudge wants.
				if (queryClient.isFetching({ queryKey: ['sync', collectionName] }) > 0) continue
				// Swallow rejections: a failed refetch records a query error on the tracker via the
				// collection's own onError, and must not surface as an unhandled promise rejection.
				const result = refetch()
				if (result) {
					nudged.push(collectionName)
					result.catch(() => undefined)
				}
			}
			if (nudged.length > 0) {
				console.debug('[SyncProvider] recovery nudge', { trigger, nudged })
			}
		}

		const handleOnline = () => refetchDegradedCollections('online')
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') refetchDegradedCollections('visibilitychange')
		}

		window.addEventListener('online', handleOnline)
		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => {
			window.removeEventListener('online', handleOnline)
			document.removeEventListener('visibilitychange', handleVisibilityChange)
		}
	})

	// ---- Swap collections based on current mode ----
	// Refs are populated synchronously in the tracker.onChange callback before React re-renders.
	// Defensive fallback to electric collection if the ref is null (e.g. on first render
	// before the useEffect has run but tracker is already in query mode).

	const sessionsCollection =
		modes.sessions === 'query' ? (sessionsQueryRef.current ?? sessionsElectric) : sessionsElectric
	const onlineHostsCollection =
		modes.onlineHosts === 'query' ? (onlineHostsQueryRef.current ?? onlineHostsElectric) : onlineHostsElectric
	const tasksCollection = modes.tasks === 'query' ? (tasksQueryRef.current ?? tasksElectric) : tasksElectric
	const eventsCollection =
		modes.conversationEvents === 'query' ? (eventsQueryRef.current ?? eventsElectric) : eventsElectric
	const artifactsCollection =
		modes.artifacts === 'query' ? (artifactsQueryRef.current ?? artifactsElectric) : artifactsElectric
	const approvalsCollection =
		modes.approvals === 'query' ? (approvalsQueryRef.current ?? approvalsElectric) : approvalsElectric
	const artifactCommentsCollection =
		modes.artifactComments === 'query'
			? (artifactCommentsQueryRef.current ?? artifactCommentsElectric)
			: artifactCommentsElectric
	const diffCommentsCollection =
		modes.diffComments === 'query' ? (diffCommentsQueryRef.current ?? diffCommentsElectric) : diffCommentsElectric
	const artifactsMetadataCollection =
		modes.artifactsMetadata === 'query'
			? (artifactsMetadataQueryRef.current ?? artifactsMetadataElectric)
			: artifactsMetadataElectric
	const taskOrganizationAclsCollection =
		modes.taskOrganizationAcls === 'query'
			? (taskOrganizationAclsQueryRef.current ?? taskOrganizationAclsElectric)
			: taskOrganizationAclsElectric
	const taskUserAclsCollection =
		modes.taskUserAcls === 'query' ? (taskUserAclsQueryRef.current ?? taskUserAclsElectric) : taskUserAclsElectric
	const taskUserSettingsCollection =
		modes.taskUserSettings === 'query'
			? (taskUserSettingsQueryRef.current ?? taskUserSettingsElectric)
			: taskUserSettingsElectric
	const taskWorkspaceSetupForHostCollection =
		modes.workspaceSetup === 'query'
			? (taskWorkspaceSetupForHostQueryRef.current ?? taskWorkspaceSetupForHostElectric)
			: taskWorkspaceSetupForHostElectric

	const queuedMessagesCollection =
		modes.queuedMessages === 'query'
			? (queuedMessagesQueryRef.current ?? queuedMessagesElectric)
			: queuedMessagesElectric
	// Reads the query-mode ref during render like every other collection in this provider; the
	// degradation swap is shared across all of them and a compiler-safe rewrite belongs to that pattern.
	const providerLoginRequestsCollection =
		modes.providerLoginRequests === 'query'
			? // eslint-disable-next-line react-hooks-js/refs
				(providerLoginRequestsQueryRef.current ?? providerLoginRequestsElectric)
			: providerLoginRequestsElectric

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
			conversationEvents: async (txId: string | number): Promise<void> => {
				if (modes.conversationEvents === 'query' && eventsQueryRef.current) {
					await eventsQueryRef.current.utils.refetch()
				} else {
					await eventsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			approvals: async (txId: string | number): Promise<void> => {
				if (modes.approvals === 'query' && approvalsQueryRef.current) {
					await approvalsQueryRef.current.utils.refetch()
				} else {
					await approvalsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifactComments: async (txId: string | number): Promise<void> => {
				if (modes.artifactComments === 'query' && artifactCommentsQueryRef.current) {
					await artifactCommentsQueryRef.current.utils.refetch()
				} else {
					await artifactCommentsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			diffComments: async (txId: string | number): Promise<void> => {
				if (modes.diffComments === 'query' && diffCommentsQueryRef.current) {
					await diffCommentsQueryRef.current.utils.refetch()
				} else {
					await diffCommentsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifacts: async (txId: string | number): Promise<void> => {
				if (modes.artifacts === 'query' && artifactsQueryRef.current) {
					await artifactsQueryRef.current.utils.refetch()
				} else {
					await artifactsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			artifactsMetadata: async (txId: string | number): Promise<void> => {
				if (modes.artifactsMetadata === 'query' && artifactsMetadataQueryRef.current) {
					await artifactsMetadataQueryRef.current.utils.refetch()
				} else {
					await artifactsMetadataElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			taskOrganizationAcls: async (txId: string | number): Promise<void> => {
				if (modes.taskOrganizationAcls === 'query' && taskOrganizationAclsQueryRef.current) {
					await taskOrganizationAclsQueryRef.current.utils.refetch()
				} else {
					await taskOrganizationAclsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			taskUserAcls: async (txId: string | number): Promise<void> => {
				if (modes.taskUserAcls === 'query' && taskUserAclsQueryRef.current) {
					await taskUserAclsQueryRef.current.utils.refetch()
				} else {
					await taskUserAclsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			taskUserSettings: async (txId: string | number): Promise<void> => {
				if (modes.taskUserSettings === 'query' && taskUserSettingsQueryRef.current) {
					await taskUserSettingsQueryRef.current.utils.refetch()
				} else {
					await taskUserSettingsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			workspaceSetup: async (txId: string | number): Promise<void> => {
				if (modes.workspaceSetup === 'query' && taskWorkspaceSetupForHostQueryRef.current) {
					await taskWorkspaceSetupForHostQueryRef.current.utils.refetch()
				} else {
					await taskWorkspaceSetupForHostElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			queuedMessages: async (txId: string | number): Promise<void> => {
				if (modes.queuedMessages === 'query' && queuedMessagesQueryRef.current) {
					await queuedMessagesQueryRef.current.utils.refetch()
				} else {
					await queuedMessagesElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
			providerLoginRequests: async (txId: string | number): Promise<void> => {
				if (modes.providerLoginRequests === 'query' && providerLoginRequestsQueryRef.current) {
					await providerLoginRequestsQueryRef.current.utils.refetch()
				} else {
					await providerLoginRequestsElectric.utils.awaitTxId(Number(txId), AWAIT_TX_TIMEOUT)
				}
			},
		}),
		[
			modes.sessions,
			modes.tasks,
			modes.conversationEvents,
			modes.approvals,
			modes.artifactComments,
			modes.diffComments,
			modes.artifacts,
			modes.artifactsMetadata,
			modes.taskOrganizationAcls,
			modes.taskUserAcls,
			modes.taskUserSettings,
			modes.workspaceSetup,
			modes.queuedMessages,
			modes.providerLoginRequests,
			sessionsElectric,
			tasksElectric,
			eventsElectric,
			approvalsElectric,
			artifactCommentsElectric,
			diffCommentsElectric,
			artifactsElectric,
			artifactsMetadataElectric,
			taskOrganizationAclsElectric,
			taskUserAclsElectric,
			taskUserSettingsElectric,
			taskWorkspaceSetupForHostElectric,
			queuedMessagesElectric,
			providerLoginRequestsElectric,
		],
	)

	return (
		<SyncInternalContext.Provider value={{ tracker, modes, syncAuthReady, confirmTx }}>
			<SyncContext.Provider
				value={{
					sessionsCollection,
					tasksCollection,
					eventsCollection,
					onlineHostsCollection,
					approvalsCollection,
					artifactCommentsCollection,
					diffCommentsCollection,
					artifactsCollection,
					artifactsMetadataCollection,
					taskOrganizationAclsCollection,
					taskUserAclsCollection,
					taskUserSettingsCollection,
					taskWorkspaceSetupForHostCollection,
					queuedMessagesCollection,
					agentSlashCommandsCollection: agentSlashCommandsElectric,
					providerLoginRequestsCollection,
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

/**
 * Public hook for UI components that need to read synced data.
 *
 * Returns the active collection for each table — either the Electric-backed
 * real-time collection or the query-backed fallback, depending on the current
 * health of the Electric sync stream. Consumers don't need to know which
 * engine is active; they just use the returned collection with TanStack DB
 * live queries as usual.
 */
export const useSync = () => {
	const context = use(SyncContext)
	if (!context) throw new Error('useSync must be used within a SyncProvider')
	return context
}

/**
 * Internal hook for sync infrastructure — write paths, actions, and status UI.
 *
 * Returns the CollectionHealthTracker (for reading/forcing electric↔query
 * mode), the per-collection mode map, and `confirmTx` helpers that abstract
 * the post-write sync confirmation strategy: awaiting Electric's txId when in
 * electric mode, or triggering an immediate refetch when in query mode.
 *
 * Not intended for general UI components — use `useSync()` instead.
 */
export const useSyncInternal = () => {
	const context = use(SyncInternalContext)
	if (!context) throw new Error('useSyncInternal must be used within a SyncProvider')
	return context
}
