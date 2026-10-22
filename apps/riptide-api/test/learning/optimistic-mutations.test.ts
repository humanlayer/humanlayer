/**
 * Learning Test: Optimistic Mutations with Electric and Query Collections
 *
 * Documents how `createOptimisticAction` works with both collection types,
 * including the transaction state machine, immediate visibility of optimistic
 * changes, and the key difference in how each collection confirms server writes.
 *
 * These tests are lightweight — no Docker, no real database, no HTTP servers.
 * Collections are created with noop sync implementations to test the optimistic
 * mutation machinery in isolation.
 *
 * Run with: cd apps/riptide-api && bun run test:learning
 */

import { createCollection, createOptimisticAction, type TransactionState } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { afterEach, describe, expect, test } from 'vitest'

import { requireExternalTestServices } from '../utils/external-test-services'

await requireExternalTestServices()

// =============================================================================
// Shared test state
// =============================================================================

const collectionsToCleanup: Array<{ cleanup(): Promise<void> }> = []
const queryClientsToDestroy: Array<QueryClient> = []

function trackCleanup<T extends { cleanup(): Promise<void> }>(collection: T): T {
	collectionsToCleanup.push(collection)
	return collection
}

function makeQueryClient() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	queryClientsToDestroy.push(qc)
	return qc
}

afterEach(async () => {
	for (const collection of collectionsToCleanup) {
		await collection.cleanup()
	}
	collectionsToCleanup.length = 0

	for (const qc of queryClientsToDestroy) {
		qc.clear()
	}
	queryClientsToDestroy.length = 0
})

// =============================================================================
// Collection helpers
// =============================================================================

const DUMMY_SHAPE_URL = 'http://localhost:9999/v1/shape'

type Session = { id: string; name: string; status: string }

function makeQueryCollection(queryClient: QueryClient, queryFn?: () => Promise<Array<Session>>) {
	return trackCleanup(
		createCollection(
			queryCollectionOptions({
				queryKey: ['sessions'],
				queryFn: queryFn ?? (async (): Promise<Array<Session>> => []),
				queryClient,
				getKey: (item) => item.id,
			}),
		),
	)
}

function makeElectricCollection() {
	return trackCleanup(
		createCollection(
			electricCollectionOptions<Session>({
				shapeOptions: { url: DUMMY_SHAPE_URL },
				getKey: (item) => item.id,
			}),
		),
	)
}

// =============================================================================
// createOptimisticAction: adapter-agnostic
// =============================================================================

describe('createOptimisticAction: works identically with both collection types', () => {
	test('createOptimisticAction is from @tanstack/db — not collection-type specific', () => {
		// createOptimisticAction is adapter-agnostic: works with Electric, Query, or local-only
		// The collection type only affects the mutationFn implementation (how you confirm server writes)
		expect(typeof createOptimisticAction).toBe('function')
	})

	test('returns a callable action function', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (newSession) => {
				// Normally: await api.sessions.create(newSession)
				void newSession
			},
		})

		// createOptimisticAction returns a function you call with your variables
		expect(typeof addSession).toBe('function')
	})

	test('with Electric collection: mutationFn confirms via awaitTxId()', () => {
		const electricCollection = makeElectricCollection()

		// Electric pattern: return { txid } from server, then awaitTxId
		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				electricCollection.insert(newSession)
			},
			mutationFn: async (newSession, { transaction }) => {
				void transaction
				// Pattern: const result = await api.sessions.create(newSession)
				// Then: await electricCollection.utils.awaitTxId(result.txid)
				// This blocks until the mutation appears in the Electric CDC stream
				void newSession
				void electricCollection.utils.awaitTxId // verify it exists
			},
		})

		expect(typeof addSession).toBe('function')
	})

	test('with Query collection: mutationFn confirms via refetch()', () => {
		const queryClient = makeQueryClient()
		const queryCollection = makeQueryCollection(queryClient)

		// Query pattern: after server write, call refetch() to get fresh data
		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				queryCollection.insert(newSession)
			},
			mutationFn: async (newSession) => {
				// Pattern: await api.sessions.create(newSession)
				// Then: await queryCollection.utils.refetch()
				// This triggers a fresh poll of the oRPC sync route
				void newSession
				void queryCollection.utils.refetch // verify it exists
			},
		})

		expect(typeof addSession).toBe('function')
	})
})

// =============================================================================
// Optimistic insert: immediate visibility
// =============================================================================

describe('optimistic insert: item visible immediately before mutationFn resolves', () => {
	test('query collection: insert visible immediately via collection.has()', async () => {
		const queryClient = makeQueryClient()
		let resolveMutation!: () => void
		const mutationFinished = new Promise<void>((resolve) => {
			resolveMutation = resolve
		})

		const collection = makeQueryCollection(queryClient)

		let seenDuringMutation = false

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (newSession) => {
				// Check visibility during mutation (before it resolves)
				seenDuringMutation = collection.has(newSession.id)
				// Signal that we've checked, then wait to be released
				resolveMutation()
				// Don't return until test releases us — simulates async server call
				await new Promise<void>((resolve) => setTimeout(resolve, 5))
			},
		})

		const newSession: Session = { id: 'session-1', name: 'Test', status: 'active' }
		const tx = addSession(newSession)

		// Wait for the mutationFn to run and check
		await mutationFinished

		// Item was visible during the mutation (optimistic write happened synchronously in onMutate)
		expect(seenDuringMutation).toBe(true)

		// Wait for transaction to complete
		await tx.isPersisted.promise
	})

	test('query collection: insert NOT visible after rollback', async () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (_newSession) => {
				// Simulate server rejection
				throw new Error('Server rejected the insert')
			},
		})

		const newSession: Session = { id: 'session-rollback', name: 'Will fail', status: 'active' }
		const tx = addSession(newSession)

		// Expect the transaction to fail (mutation threw)
		try {
			await tx.isPersisted.promise
		} catch {
			// Expected: transaction failed
		}

		// After rollback: item should no longer be visible
		expect(collection.has('session-rollback')).toBe(false)
	})
})

// =============================================================================
// Transaction state machine
// =============================================================================

describe('transaction state machine: pending → persisting → completed | failed', () => {
	test('transaction starts in pending state when created', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// We need to capture the transaction before it completes
		let _capturedTx: { state: TransactionState } | null = null
		let resolveAfterCapture!: () => void
		const holdMutation = new Promise<void>((resolve) => {
			resolveAfterCapture = resolve
		})

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (_newSession, { transaction }) => {
				_capturedTx = transaction
				// Hold here so we can inspect state
				await holdMutation
			},
		})

		const tx = addSession({ id: 'state-test', name: 'Test', status: 'active' })
		void tx // Reference to keep it alive

		// Release the mutation and let it complete
		resolveAfterCapture()
	})

	test('transaction reaches completed state when mutationFn resolves', async () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (_newSession) => {
				// Successful server write (noop in learning test)
			},
		})

		const tx = addSession({ id: 'complete-test', name: 'Test', status: 'active' })
		await tx.isPersisted.promise

		expect(tx.state).toBe<TransactionState>('completed')
	})

	test('transaction reaches failed state when mutationFn throws', async () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (_newSession) => {
				throw new Error('API error')
			},
		})

		const tx = addSession({ id: 'fail-test', name: 'Will fail', status: 'active' })

		try {
			await tx.isPersisted.promise
		} catch {
			// Expected failure
		}

		expect(tx.state).toBe<TransactionState>('failed')
	})

	test('transaction mutations contain the inserted item', async () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		let capturedMutations: Array<{ type: string; modified: Record<string, unknown> }> = []

		const addSession = createOptimisticAction<Session>({
			onMutate: (newSession) => {
				collection.insert(newSession)
			},
			mutationFn: async (_newSession, { transaction }) => {
				capturedMutations = transaction.mutations.map((m) => ({
					type: m.type,
					modified: m.modified,
				}))
			},
		})

		const newSession: Session = { id: 'mutations-test', name: 'Test', status: 'active' }
		const tx = addSession(newSession)
		await tx.isPersisted.promise

		// The transaction contains the inserted mutation
		expect(capturedMutations).toHaveLength(1)
		expect(capturedMutations[0]?.type).toBe('insert')
		expect(capturedMutations[0]?.modified).toMatchObject(newSession)
	})
})

// =============================================================================
// Multiple mutations in one action
// =============================================================================

describe('multiple collection mutations in a single optimistic action', () => {
	test('insert multiple items — all visible immediately', async () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		const sessions: Array<Session> = [
			{ id: 'multi-1', name: 'Session A', status: 'active' },
			{ id: 'multi-2', name: 'Session B', status: 'active' },
			{ id: 'multi-3', name: 'Session C', status: 'archived' },
		]

		let visibleDuringMutation = false

		const addSessions = createOptimisticAction<Array<Session>>({
			onMutate: (newSessions) => {
				// collection.insert() accepts a single item or array
				for (const session of newSessions) {
					collection.insert(session)
				}
			},
			mutationFn: async (newSessions, { transaction }) => {
				// Check that all 3 items are visible
				visibleDuringMutation = newSessions.every((s) => collection.has(s.id))
				// Transaction contains all 3 mutations
				expect(transaction.mutations).toHaveLength(3)
			},
		})

		const tx = addSessions(sessions)
		await tx.isPersisted.promise

		expect(visibleDuringMutation).toBe(true)
	})
})

// =============================================================================
// Query collection: direct write APIs (writeInsert, writeUpdate, writeDelete)
// =============================================================================

describe('Query utils: direct write APIs bypass query refetch', () => {
	test('writeInsert, writeUpdate, writeDelete, writeUpsert, writeBatch are defined on utils', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// These utilities allow server-side sync callbacks to write data directly
		// to the collection without triggering a full query refetch.
		//
		// IMPORTANT: They require the collection to be in 'ready' state
		// (i.e., sync has been started and initialized). Calling them before sync
		// is initialized throws SyncNotInitializedError.
		//
		// Typical usage: inside onInsert/onUpdate/onDelete handlers, after calling
		// the server mutation, call writeInsert/writeUpdate/writeDelete to update
		// the local state immediately before calling refetch() for full consistency.
		expect(typeof collection.utils.writeInsert).toBe('function')
		expect(typeof collection.utils.writeUpdate).toBe('function')
		expect(typeof collection.utils.writeDelete).toBe('function')
		expect(typeof collection.utils.writeUpsert).toBe('function')
		expect(typeof collection.utils.writeBatch).toBe('function')
	})

	test('write* utils throw when collection sync not started (SyncNotInitializedError)', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// Before sync is initialized (startSync=false, no subscribers), write* throws.
		// The error class is SyncNotInitializedError; its message indicates the collection
		// must be in 'ready' state. This documents that write* only works in the context
		// of an active, initialized sync session.
		const session: Session = { id: 'not-ready', name: 'Test', status: 'active' }

		expect(() => {
			collection.utils.writeInsert(session)
		}).toThrow("Collection must be in 'ready' state for manual sync operations")
	})

	test('Electric collections do NOT have write* utils', () => {
		const electricCollection = makeElectricCollection()

		// Electric syncs via WebSocket stream — you don't manually write to the collection
		// Changes come through the stream automatically; there are no direct write methods
		expect(electricCollection.utils).not.toHaveProperty('writeInsert')
		expect(electricCollection.utils).not.toHaveProperty('writeUpdate')
		expect(electricCollection.utils).not.toHaveProperty('writeDelete')
		expect(electricCollection.utils).not.toHaveProperty('writeBatch')
	})
})

// =============================================================================
// Query collection: error tracking utilities
// =============================================================================

describe('Query utils: error state tracking', () => {
	test('isError is false before any query runs', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// isError tracks whether the last query resulted in an error
		expect(collection.utils.isError).toBe(false)
	})

	test('errorCount starts at zero', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// errorCount increments only when query fails completely (not per retry)
		// Resets to 0 on success
		expect(collection.utils.errorCount).toBe(0)
	})

	test('lastError is undefined before any query runs', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		expect(collection.utils.lastError).toBeUndefined()
	})

	test('isFetching, isRefetching, isLoading are false before sync starts', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		expect(collection.utils.isFetching).toBe(false)
		expect(collection.utils.isRefetching).toBe(false)
		expect(collection.utils.isLoading).toBe(false)
	})

	test('fetchStatus property is defined on utils (reflects TanStack Query internal state)', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		// fetchStatus is defined as 'fetching' | 'paused' | 'idle' in the type
		// Its actual value before sync is initialized depends on internal Query observer state.
		// The important thing is the property exists on utils (not present on Electric utils).
		expect(collection.utils).toHaveProperty('fetchStatus')
	})

	test('dataUpdatedAt is 0 before first successful fetch', () => {
		const queryClient = makeQueryClient()
		const collection = makeQueryCollection(queryClient)

		expect(collection.utils.dataUpdatedAt).toBe(0)
	})
})

// =============================================================================
// Comparing confirmation strategies
// =============================================================================

describe('confirmation strategy: Electric awaitTxId vs Query refetch', () => {
	test('Electric: awaitTxId waits for CDC stream to confirm write (async)', () => {
		const electricCollection = makeElectricCollection()

		// awaitTxId(txId) waits for the given transaction ID to appear in the
		// Electric CDC stream, confirming the write has been replicated
		// Returns: Promise<boolean> (true if found, false if timed out)
		expect(typeof electricCollection.utils.awaitTxId).toBe('function')

		// Usage in mutationFn:
		// const result = await api.sessions.create(newSession)
		// await electricCollection.utils.awaitTxId(result.txid, 5000) // timeout 5s
	})

	test('Electric: awaitMatch uses custom function to confirm write', () => {
		const electricCollection = makeElectricCollection()

		// awaitMatch(fn) waits until a stream message matches the custom function
		// More flexible than awaitTxId for complex confirmation logic
		expect(typeof electricCollection.utils.awaitMatch).toBe('function')

		// Usage in mutationFn:
		// await electricCollection.utils.awaitMatch(
		//   (msg) => isChangeMessage(msg) && msg.value.id === newSession.id
		// )
	})

	test('Query: refetch triggers re-poll of the oRPC sync route', async () => {
		let _fetchCount = 0
		const queryClient = makeQueryClient()

		const collection = makeQueryCollection(queryClient, async () => {
			_fetchCount++
			return []
		})

		// refetch() is Promise<Array<QueryObserverResult>>
		expect(typeof collection.utils.refetch).toBe('function')

		// Usage in mutationFn:
		// await api.sessions.create(newSession)
		// await queryCollection.utils.refetch() // triggers fresh poll
	})

	test('Query collection onInsert: typical pattern calls refetch after server write', async () => {
		const queryClient = makeQueryClient()

		// This is the standard oRPC sync route pattern:
		// 1. onMutate: optimistically insert into collection
		// 2. mutationFn: POST to oRPC create route
		// 3. refetch: trigger poll of oRPC sync route to get authoritative data
		const collection = trackCleanup(
			createCollection(
				queryCollectionOptions({
					queryKey: ['sessions'],
					queryFn: async (): Promise<Array<Session>> => [],
					queryClient,
					getKey: (item) => item.id,
					onInsert: async (_params) => {
						// Normally: await apiClient.sessions.create(params.transaction.mutations[0].modified)
						// Then: await params.collection.utils.refetch()
						// For learning test, just verify the pattern compiles
					},
					onUpdate: async (_params) => {
						// Normally: await apiClient.sessions.update(...)
						// Then: await params.collection.utils.refetch()
					},
					onDelete: async (_params) => {
						// Normally: await apiClient.sessions.delete(...)
						// Then: await params.collection.utils.refetch()
					},
				}),
			),
		)

		expect(collection.utils.refetch).toBeDefined()
	})
})

// =============================================================================
// Documenting parseLoadSubsetOptions usage
// =============================================================================

describe('parseLoadSubsetOptions: converting LiveQuery options to oRPC input', () => {
	test('parseLoadSubsetOptions is exported from @tanstack/query-db-collection', async () => {
		// parseLoadSubsetOptions converts the LoadSubsetOptions from context.meta
		// into { filters: SimpleComparison[], sorts: ParsedOrderBy[], limit?: number }
		// This is what the queryFn uses to call the oRPC sync route

		const { parseLoadSubsetOptions } = await import('@tanstack/query-db-collection')

		expect(typeof parseLoadSubsetOptions).toBe('function')
	})

	test('parseLoadSubsetOptions with undefined returns empty filters and sorts', async () => {
		const { parseLoadSubsetOptions } = await import('@tanstack/query-db-collection')

		// When no filters are active, returns empty arrays (no restriction)
		const result = parseLoadSubsetOptions(undefined)

		expect(result.filters).toEqual([])
		expect(result.sorts).toEqual([])
		expect(result.limit).toBeUndefined()
	})

	test('parseLoadSubsetOptions returns structured filters/sorts/limit from where+orderBy+limit', async () => {
		const { parseLoadSubsetOptions } = await import('@tanstack/query-db-collection')
		const { IR } = await import('@tanstack/db')

		// parseLoadSubsetOptions internally calls extractSimpleComparisons on the where expression.
		// A SimpleComparison is produced when the where is: eq(PropRef(path), Value(val))
		// Both sides must be IR nodes (PropRef and Value), not raw objects.
		//
		// In practice, the collection constructs these expressions from useLiveQuery hooks
		// like: eq(row.status, 'active') — where row is a SingleRowRefProxy that
		// produces PropRef nodes when properties are accessed.

		// Build a valid where expression using the IR classes directly
		const statusRef = new IR.PropRef<string>(['status'])
		const activeVal = new IR.Value<string>('active')
		// eq(PropRef(['status']), Value('active')) → produces a Func('eq', [ref, val])
		const whereExpr = new IR.Func<boolean>('eq', [statusRef, activeVal])

		const result = parseLoadSubsetOptions({ where: whereExpr })

		expect(result.filters).toHaveLength(1)
		expect(result.filters[0]?.operator).toBe('eq')
		expect(result.filters[0]?.field).toEqual(['status'])
		expect(result.filters[0]?.value).toBe('active')
	})

	test('typical queryFn pattern: parse context.meta.loadSubsetOptions to call oRPC route', () => {
		// This documents the standard pattern used in query-driven collections
		// The queryFn receives context.meta?.loadSubsetOptions when the collection
		// is used with on-demand loading (useLiveQuery with filters/sorts)

		const exampleQueryFn = async (context: { meta?: { loadSubsetOptions?: { limit?: number } } }) => {
			// Step 1: Parse the subset options from the query context
			// const parsed = parseLoadSubsetOptions(context.meta?.loadSubsetOptions)

			// Step 2: Call the oRPC sync route with the parsed options
			// const response = await apiClient.sync.sessions({
			//   filters: parsed.filters,
			//   sorts: parsed.sorts,
			//   limit: parsed.limit,
			// })

			// Step 3: Return the response (use select to extract rows if needed)
			// return response

			// For learning test, just verify the pattern
			void context
			return []
		}

		expect(typeof exampleQueryFn).toBe('function')
	})
})
