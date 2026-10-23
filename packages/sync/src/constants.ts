/**
 * Number of consecutive Electric successes required to recover from query fallback
 * back to Electric mode.
 */
export const RECOVERY_SUCCESS_THRESHOLD = 3

/**
 * Number of consecutive Electric errors required before degrading a collection to the
 * query (polling) fallback. Set above 1 so a single transient long-poll connection drop
 * doesn't flap the collection into query mode (CORE-1326).
 */
export const DEGRADE_ERROR_THRESHOLD = 3

/**
 * Timeout in milliseconds for awaitTxId calls in Electric mode.
 */
export const AWAIT_TX_TIMEOUT = 10_000

/**
 * All known collection names across riptide-ui, riptide-cloud, and riptide-daemon.
 */
export type CollectionName =
	| 'approvals'
	| 'artifactComments'
	| 'artifacts'
	| 'artifactsMetadata'
	| 'conversationEvents'
	| 'diffComments'
	| 'onlineHosts'
	| 'providerLoginRequests'
	| 'queuedMessages'
	| 'sessions'
	| 'taskOrganizationAcls'
	| 'taskUserAcls'
	| 'taskUserSettings'
	| 'workspaceSetup'
	| 'tasks'

/**
 * Refetch intervals in milliseconds for each collection when in query fallback mode.
 * Lower values for time-sensitive collections, higher values for less-frequently-changing data.
 */
export const REFETCH_INTERVALS: Record<CollectionName, number> = {
	conversationEvents: 4_000,
	approvals: 10_000,
	artifactComments: 10_000,
	diffComments: 10_000,
	sessions: 10_000,
	artifacts: 10_000,
	artifactsMetadata: 10_000,
	tasks: 10_000,
	onlineHosts: 10_000,
	providerLoginRequests: 2_000,
	queuedMessages: 10_000,
	taskOrganizationAcls: 10_000,
	taskUserAcls: 10_000,
	taskUserSettings: 10_000,
	workspaceSetup: 10_000,
}
