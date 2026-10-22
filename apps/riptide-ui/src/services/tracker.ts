import { CollectionHealthTracker, REFETCH_INTERVALS } from '@humanlayer/sync'

/**
 * Singleton CollectionHealthTracker instance.
 * Shared between SyncProvider (for mode switching) and preload service (for collection access).
 *
 * The tracked set is derived from REFETCH_INTERVALS (typed `Record<CollectionName, number>`)
 * so every syncable collection is registered: an unregistered collection never degrades from a
 * stalled Electric shape to query mode and hangs in `loading` forever.
 */
export const tracker = new CollectionHealthTracker({
	collections: [...Object.keys(REFETCH_INTERVALS), 'agentSlashCommands'],
})
