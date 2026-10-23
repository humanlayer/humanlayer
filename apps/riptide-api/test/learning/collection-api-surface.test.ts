/**
 * Learning Test: ElectricCollection vs QueryCollection API Surface
 *
 * Documents the differences and similarities between `electricCollectionOptions`
 * and `queryCollectionOptions` factory functions. These tests are lightweight —
 * no Docker, no real database, no HTTP servers.
 *
 * They create collections with mock/noop implementations (queryFn: async () => [],
 * shapeOptions: { url: 'http://localhost:9999/v1/shape' }) and verify the API shapes.
 *
 * Run with: cd apps/riptide-api && bun run test:learning
 */

import { type CollectionStatus, createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { afterEach, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'

await requireExternalTestServices()

// =============================================================================
// Shared test state
// =============================================================================

// Track all collections created so we can clean them up between tests
const collectionsToCleanup: Array<{ cleanup(): Promise<void> }> = []

function trackCleanup<T extends { cleanup(): Promise<void> }>(collection: T): T {
	collectionsToCleanup.push(collection)
	return collection
}

afterEach(async () => {
	for (const collection of collectionsToCleanup) {
		await collection.cleanup()
	}
	collectionsToCleanup.length = 0
})

// =============================================================================
// Minimal test configs
// =============================================================================

const DUMMY_SHAPE_URL = 'http://localhost:9999/v1/shape'

type TodoItem = { id: string; title: string; completed: boolean }

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
}

/**
 * Create a minimal electric collection (no real Electric server connection).
 * The shape URL is a dummy — we never actually start sync in these tests.
 */
function makeElectricCollection() {
	return trackCleanup(
		createCollection(
			electricCollectionOptions<TodoItem>({
				shapeOptions: {
					url: DUMMY_SHAPE_URL,
					// Don't actually connect — tests only inspect API shape
				},
				getKey: (item) => item.id,
				// startSync defaults to false — no connection attempt
			}),
		),
	)
}

/**
 * Create a minimal query collection with a noop queryFn.
 * No real server is needed — queryFn returns empty array immediately.
 */
function makeQueryCollection(queryClient: QueryClient) {
	return trackCleanup(
		createCollection(
			queryCollectionOptions({
				queryKey: ['todos'],
				queryFn: async (): Promise<Array<TodoItem>> => [],
				queryClient,
				getKey: (item) => item.id,
				// startSync defaults to false — queryFn won't be called
			}),
		),
	)
}

// =============================================================================
// Factory pattern differences
// =============================================================================

describe('factory pattern: electricCollectionOptions', () => {
	test('requires shapeOptions with url', () => {
		// electricCollectionOptions configures the ElectricSQL ShapeStream
		const opts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
		})

		// Returns a CollectionConfig consumable by createCollection()
		expect(opts).toHaveProperty('sync')
		expect(opts).toHaveProperty('getKey')
		expect(opts).toHaveProperty('utils')
		// Electric-specific utils: awaitTxId and awaitMatch
		expect(typeof opts.utils.awaitTxId).toBe('function')
		expect(typeof opts.utils.awaitMatch).toBe('function')
	})

	test('does NOT have refetch, writeInsert, isError in utils', () => {
		const opts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
		})

		// These are Query-specific utilities — not present on Electric utils
		expect(opts.utils).not.toHaveProperty('refetch')
		expect(opts.utils).not.toHaveProperty('writeInsert')
		expect(opts.utils).not.toHaveProperty('isError')
		expect(opts.utils).not.toHaveProperty('errorCount')
		expect(opts.utils).not.toHaveProperty('fetchStatus')
		expect(opts.utils).not.toHaveProperty('dataUpdatedAt')
	})
})

describe('factory pattern: queryCollectionOptions', () => {
	test('requires queryKey, queryFn, and queryClient', () => {
		const queryClient = makeQueryClient()

		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		// Returns a CollectionConfig consumable by createCollection()
		expect(opts).toHaveProperty('sync')
		expect(opts).toHaveProperty('getKey')
		expect(opts).toHaveProperty('utils')
	})

	test('includes Query-specific utils: refetch, writeInsert, writeUpdate, writeDelete, isError, errorCount, fetchStatus, dataUpdatedAt', () => {
		const queryClient = makeQueryClient()

		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		// Query-specific utility methods
		expect(typeof opts.utils.refetch).toBe('function')
		expect(typeof opts.utils.writeInsert).toBe('function')
		expect(typeof opts.utils.writeUpdate).toBe('function')
		expect(typeof opts.utils.writeDelete).toBe('function')
		expect(typeof opts.utils.writeUpsert).toBe('function')
		expect(typeof opts.utils.writeBatch).toBe('function')
		expect(typeof opts.utils.clearError).toBe('function')
	})

	test('includes Query-specific status properties: isError, errorCount, isFetching, isRefetching, isLoading, dataUpdatedAt, fetchStatus', () => {
		const queryClient = makeQueryClient()

		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		// These are getter properties on the utils object
		expect(opts.utils).toHaveProperty('isError')
		expect(opts.utils).toHaveProperty('errorCount')
		expect(opts.utils).toHaveProperty('isFetching')
		expect(opts.utils).toHaveProperty('isRefetching')
		expect(opts.utils).toHaveProperty('isLoading')
		expect(opts.utils).toHaveProperty('dataUpdatedAt')
		expect(opts.utils).toHaveProperty('fetchStatus')
		expect(opts.utils).toHaveProperty('lastError')
	})

	test('does NOT have awaitTxId or awaitMatch in utils', () => {
		const queryClient = makeQueryClient()

		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		// These are Electric-specific utilities — not present on Query utils
		expect(opts.utils).not.toHaveProperty('awaitTxId')
		expect(opts.utils).not.toHaveProperty('awaitMatch')
	})

	test('select option extracts row array from response with wrapper object', () => {
		const queryClient = makeQueryClient()

		// This is the oRPC sync route pattern: server returns { rows: [...] }
		// The select function extracts the array for the collection
		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<{ rows: Array<TodoItem> }> => ({ rows: [] }),
			select: (data) => data.rows,
			queryClient,
			getKey: (item) => item.id,
		})

		expect(opts).toHaveProperty('sync')
		expect(opts).toHaveProperty('utils')
	})

	test('supports refetchInterval for polling-based sync', () => {
		const queryClient = makeQueryClient()

		// Query collections can poll — Electric uses WebSocket streaming instead
		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
			refetchInterval: 5000, // Poll every 5 seconds
		})

		expect(opts).toHaveProperty('sync')
	})
})

// =============================================================================
// Shared collection API (identical on both)
// =============================================================================

describe('read API: identical on Electric and Query collections', () => {
	test('both start in idle status when startSync is false', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		// Both start idle — no sync attempted until startSync=true or first subscriber
		expect(electric.status).toBe<CollectionStatus>('idle')
		expect(query.status).toBe<CollectionStatus>('idle')
	})

	test('both have get(), has(), size, keys(), values(), entries(), toArray', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		// Read methods are identical on both collection types
		expect(typeof electric.get).toBe('function')
		expect(typeof query.get).toBe('function')

		expect(typeof electric.has).toBe('function')
		expect(typeof query.has).toBe('function')

		expect(typeof electric.size).toBe('number')
		expect(typeof query.size).toBe('number')

		expect(typeof electric.keys).toBe('function')
		expect(typeof query.keys).toBe('function')

		expect(typeof electric.values).toBe('function')
		expect(typeof query.values).toBe('function')

		expect(typeof electric.entries).toBe('function')
		expect(typeof query.entries).toBe('function')

		expect(Array.isArray(electric.toArray)).toBe(true)
		expect(Array.isArray(query.toArray)).toBe(true)
	})

	test('toArray returns empty array before any data is synced', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		expect(electric.toArray).toEqual([])
		expect(query.toArray).toEqual([])
		expect(electric.size).toBe(0)
		expect(query.size).toBe(0)
	})

	test('state returns a Map of all items', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		expect(electric.state).toBeInstanceOf(Map)
		expect(query.state).toBeInstanceOf(Map)
		expect(electric.state.size).toBe(0)
		expect(query.state.size).toBe(0)
	})

	test('both have isReady() method', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		expect(typeof electric.isReady).toBe('function')
		expect(typeof query.isReady).toBe('function')

		// Not ready until sync completes
		expect(electric.isReady()).toBe(false)
		expect(query.isReady()).toBe(false)
	})
})

describe('subscription API: identical on Electric and Query collections', () => {
	test('both have subscribeChanges(), on(), once(), off(), waitFor()', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		expect(typeof electric.subscribeChanges).toBe('function')
		expect(typeof query.subscribeChanges).toBe('function')

		expect(typeof electric.on).toBe('function')
		expect(typeof query.on).toBe('function')

		expect(typeof electric.once).toBe('function')
		expect(typeof query.once).toBe('function')

		expect(typeof electric.off).toBe('function')
		expect(typeof query.off).toBe('function')

		expect(typeof electric.waitFor).toBe('function')
		expect(typeof query.waitFor).toBe('function')
	})

	test('subscribeChanges returns a subscription object with unsubscribe', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		const electricSub = electric.subscribeChanges(() => {})
		const querySub = query.subscribeChanges(() => {})

		expect(typeof electricSub.unsubscribe).toBe('function')
		expect(typeof querySub.unsubscribe).toBe('function')

		electricSub.unsubscribe()
		querySub.unsubscribe()
	})
})

describe('mutation API: identical on Electric and Query collections', () => {
	test('both have insert(), update(), delete() methods', () => {
		const queryClient = makeQueryClient()

		const electric = makeElectricCollection()
		const query = makeQueryCollection(queryClient)

		expect(typeof electric.insert).toBe('function')
		expect(typeof query.insert).toBe('function')

		expect(typeof electric.update).toBe('function')
		expect(typeof query.update).toBe('function')

		expect(typeof electric.delete).toBe('function')
		expect(typeof query.delete).toBe('function')
	})
})

// =============================================================================
// onInsert/onUpdate/onDelete persistence handler differences
// =============================================================================

describe('persistence handlers: onInsert, onUpdate, onDelete', () => {
	test('Electric handler can return { txid } to await Electric stream confirmation', () => {
		// Electric handlers return MatchingStrategy: { txid: number } or void
		// This lets the collection wait for the mutation to appear in the Electric stream
		const opts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
			onInsert: async ({ transaction }) => {
				const newItem = transaction.mutations[0].modified
				// Typically: const result = await api.create(newItem)
				// return { txid: result.txid }
				void newItem
				return { txid: 42 } // Electric awaits this txid in the stream
			},
			onUpdate: async ({ transaction }) => {
				void transaction
				return { txid: 43 }
			},
			onDelete: async ({ transaction }) => {
				void transaction
				return void 0 // void = no stream confirmation needed
			},
		})

		expect(opts.onInsert).toBeDefined()
		expect(opts.onUpdate).toBeDefined()
		expect(opts.onDelete).toBeDefined()
	})

	test('Query handler typically calls refetch() to pull fresh data after mutation', () => {
		const queryClient = makeQueryClient()

		// Query handlers return void (not MatchingStrategy)
		// After the server write, call collection.utils.refetch() to get fresh data
		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
			onInsert: async ({ transaction, collection }) => {
				const newItem = transaction.mutations[0].modified
				// Typically: await api.create(newItem)
				// then: await collection.utils.refetch()
				void newItem
				void collection
				// No return value needed (returns void, not { txid })
			},
			onUpdate: async ({ transaction, collection }) => {
				void transaction
				void collection
			},
			onDelete: async ({ transaction, collection }) => {
				void transaction
				void collection
			},
		})

		expect(opts.onInsert).toBeDefined()
		expect(opts.onUpdate).toBeDefined()
		expect(opts.onDelete).toBeDefined()
	})

	test('Electric onInsert can also use awaitMatch() for custom stream matching', () => {
		// More advanced: use awaitMatch for custom conditions instead of txid
		const opts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
			onInsert: async ({ transaction, collection }) => {
				const newItem = transaction.mutations[0].modified
				void newItem
				// collection.utils.awaitMatch(msg => isChangeMessage(msg) && msg.value.id === newItem.id)
				void collection.utils.awaitMatch
				return void 0 // return void if using awaitMatch directly
			},
		})

		expect(opts.utils.awaitMatch).toBeDefined()
		expect(opts.utils.awaitTxId).toBeDefined()
	})
})

// =============================================================================
// syncMode differences
// =============================================================================

describe('syncMode: eager vs on-demand', () => {
	test('Electric supports eager, on-demand, and progressive sync modes', () => {
		// Electric has a third mode: progressive (syncs background, serves snapshots immediately)
		const eagerOpts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
			syncMode: 'eager', // downloads all data before marking ready
		})

		const onDemandOpts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
			syncMode: 'on-demand', // used in riptide — loads subset on query
		})

		const progressiveOpts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: DUMMY_SHAPE_URL },
			getKey: (item) => item.id,
			syncMode: 'progressive', // Electric-only: syncs in background, serves snapshots
		})

		expect(eagerOpts).toHaveProperty('sync')
		expect(onDemandOpts).toHaveProperty('sync')
		expect(progressiveOpts).toHaveProperty('sync')
	})

	test('Query collection uses polling for "background sync" (refetchInterval)', () => {
		const queryClient = makeQueryClient()

		// Query has no progressive mode — instead you use refetchInterval for polling
		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
			refetchInterval: 10_000, // Re-fetch every 10 seconds
		})

		expect(opts).toHaveProperty('sync')
	})
})

// =============================================================================
// Query-specific: select for response shape transformation
// =============================================================================

describe('select option: Query-only feature', () => {
	test('select transforms response data before storing in collection', () => {
		const queryClient = makeQueryClient()

		// oRPC sync routes return { rows: [...] }
		// The select function extracts the array TanStack DB needs
		type SyncResponse = { rows: Array<TodoItem>; meta?: { total: number } }

		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<SyncResponse> => ({
				rows: [{ id: '1', title: 'Test', completed: false }],
				meta: { total: 1 },
			}),
			select: (data) => data.rows, // Extract the rows array
			queryClient,
			getKey: (item) => item.id,
		})

		expect(opts).toHaveProperty('sync')
		expect(opts).toHaveProperty('utils')
	})

	test('without select: queryFn must return Array directly', () => {
		const queryClient = makeQueryClient()

		// Without select, queryFn must return the items array directly
		const opts = queryCollectionOptions({
			queryKey: ['todos'],
			queryFn: async (): Promise<Array<TodoItem>> => [{ id: '1', title: 'Test', completed: false }],
			queryClient,
			getKey: (item) => item.id,
			// No select needed — queryFn returns Array<TodoItem> directly
		})

		expect(opts).toHaveProperty('sync')
	})
})

// =============================================================================
// Query-specific: queryKey for cache identification
// =============================================================================

describe('queryKey: Query-specific cache key', () => {
	test('queryKey identifies this query in TanStack Query cache', () => {
		const queryClient = makeQueryClient()

		// Simple static key
		const staticOpts = queryCollectionOptions({
			queryKey: ['sessions'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		// Parameterized key (e.g. by org/user)
		const paramOpts = queryCollectionOptions({
			queryKey: ['sessions', 'org-123', 'user-456'],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		expect(staticOpts).toHaveProperty('sync')
		expect(paramOpts).toHaveProperty('sync')
	})

	test('queryKey can be a builder function receiving LoadSubsetOptions', () => {
		const queryClient = makeQueryClient()

		// The queryKey builder receives LoadSubsetOptions — allows query-specific caching
		// when using on-demand/subset loading
		const opts = queryCollectionOptions({
			queryKey: (opts) => ['sessions', opts.limit ?? 'all', opts.offset ?? 0],
			queryFn: async (): Promise<Array<TodoItem>> => [],
			queryClient,
			getKey: (item) => item.id,
		})

		expect(opts).toHaveProperty('sync')
	})

	test('Electric has no queryKey — the shape URL + parameters serve as implicit cache key', () => {
		// Electric uses shapeOptions.url as its shape identity
		// There's no TanStack Query cache involved
		const opts = electricCollectionOptions<TodoItem>({
			shapeOptions: { url: `${DUMMY_SHAPE_URL}?table=sessions` },
			getKey: (item) => item.id,
		})

		// No queryKey property
		expect(opts).not.toHaveProperty('queryKey')
		expect(opts).not.toHaveProperty('queryClient')
	})
})
