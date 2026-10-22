/**
 * Collection Assertion Helpers
 *
 * Utilities for asserting collection status, waiting for sync, and
 * verifying collection contents in tests.
 *
 * These helpers are framework-agnostic: failures throw plain `Error`s instead of
 * using a test runner's `expect`, so they work under any runner (Vitest, bun:test, ...)
 * and on any runtime (Node, Bun).
 *
 * NOTE: We use permissive `any` types in several places to avoid complex
 * generic inference issues with @tanstack/db's Collection types. The runtime
 * behavior is identical; we just skip compile-time type checking for these utilities.
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

// =============================================================================
// Types
// =============================================================================

export type CollectionStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cleaned-up'

export type WaitOptions = {
	timeout?: number
	interval?: number
}

type AnyCollection = any

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message)
	}
}

// =============================================================================
// Status Assertions
// =============================================================================

/**
 * Assert that a collection has a specific status
 */
export function expectCollectionStatus(collection: AnyCollection, expectedStatus: CollectionStatus) {
	assert(
		collection.status === expectedStatus,
		`Expected collection status '${expectedStatus}', received '${collection.status}'`,
	)
}

/**
 * Assert initial status is 'idle' for LiveQueryCollection before subscription
 */
export function expectInitialIdle(collection: AnyCollection) {
	assert(collection.status === 'idle', `Expected initial collection status 'idle', received '${collection.status}'`)
}

/**
 * Assert initial status is 'loading' for Electric collection with startSync=true
 */
export function expectInitialLoading(collection: AnyCollection) {
	assert(
		collection.status === 'loading',
		`Expected initial collection status 'loading', received '${collection.status}'`,
	)
}

/**
 * Assert status transitions to 'loading' after subscription
 */
export function expectLoadingAfterSubscribe(collection: AnyCollection) {
	collection.subscribeChanges(() => {})
	assert(
		collection.status === 'loading',
		`Expected collection status 'loading' after subscribe, received '${collection.status}'`,
	)
}

// =============================================================================
// Waiting Utilities
// =============================================================================

/**
 * Wait for a collection to reach 'ready' status
 */
export async function waitForReady(collection: AnyCollection, opts?: WaitOptions): Promise<void> {
	const timeout = opts?.timeout ?? 10_000
	const interval = opts?.interval ?? 100
	const start = Date.now()

	while (collection.status !== 'ready') {
		if (Date.now() - start > timeout) {
			throw new Error(
				`Collection did not reach 'ready' status within ${timeout}ms. Current status: ${collection.status}`,
			)
		}
		await sleep(interval)
	}
}

/**
 * Wait for multiple collections to all be ready
 */
export async function waitForAllReady(collections: AnyCollection[], opts?: WaitOptions): Promise<void> {
	const timeout = opts?.timeout ?? 10_000
	const interval = opts?.interval ?? 100
	const start = Date.now()

	while (!collections.every((c: AnyCollection) => c.status === 'ready')) {
		if (Date.now() - start > timeout) {
			const statuses = collections.map((c: AnyCollection) => c.status).join(', ')
			throw new Error(`Not all collections reached 'ready' within ${timeout}ms. Statuses: [${statuses}]`)
		}
		await sleep(interval)
	}
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(condition: () => boolean, opts?: WaitOptions): Promise<void> {
	const timeout = opts?.timeout ?? 10_000
	const interval = opts?.interval ?? 250
	const start = Date.now()

	while (!condition()) {
		if (Date.now() - start > timeout) {
			throw new Error(`Condition did not become true within ${timeout}ms`)
		}
		await sleep(interval)
	}
}

/**
 * Wait for a collection to have a specific size
 */
export async function waitForSize(collection: AnyCollection, size: number, opts?: WaitOptions): Promise<void> {
	await waitFor(() => collection.size === size, opts)
}

/**
 * Wait for a collection to have at least a specific number of items
 */
export async function waitForMinSize(collection: AnyCollection, minSize: number, opts?: WaitOptions): Promise<void> {
	await waitFor(() => collection.size >= minSize, opts)
}

/**
 * Wait for an item to appear in a collection
 */
export async function waitForItem<T extends { id: string }>(
	collection: AnyCollection,
	itemId: string,
	opts?: WaitOptions,
): Promise<T> {
	await waitFor(() => collection.has(itemId), opts)
	return collection.get(itemId) as T
}

/**
 * Wait for an item to disappear from a collection
 */
export async function waitForItemRemoved(collection: AnyCollection, itemId: string, opts?: WaitOptions): Promise<void> {
	await waitFor(() => !collection.has(itemId), opts)
}

/**
 * Wait for an item property to have a specific value
 */
export async function waitForItemProperty<T extends { id: string }, K extends keyof T>(
	collection: AnyCollection,
	itemId: string,
	property: K,
	expectedValue: T[K],
	opts?: WaitOptions,
): Promise<void> {
	await waitFor(() => {
		const item = collection.get(itemId)
		return item !== undefined && item[property] === expectedValue
	}, opts)
}

// =============================================================================
// Content Assertions
// =============================================================================

/**
 * Assert that a collection contains a specific item by ID
 */
export function expectContains(collection: AnyCollection, itemId: string) {
	assert(collection.has(itemId) === true, `Expected collection to contain item '${itemId}'`)
}

/**
 * Assert that a collection does NOT contain a specific item by ID
 */
export function expectNotContains(collection: AnyCollection, itemId: string) {
	assert(collection.has(itemId) === false, `Expected collection to not contain item '${itemId}'`)
}

/**
 * Assert that a collection is empty
 */
export function expectEmpty(collection: AnyCollection) {
	expectSize(collection, 0)
}

/**
 * Assert that a collection has a specific size
 */
export function expectSize(collection: AnyCollection, size: number) {
	assert(collection.size === size, `Expected collection size ${size}, received ${collection.size}`)
}

/**
 * Assert that an item in a collection has specific properties
 */
export function expectItemProperties<T extends { id: string }>(
	collection: AnyCollection,
	itemId: string,
	expectedProperties: Partial<T>,
) {
	const item = collection.get(itemId)
	assert(item !== undefined, `Expected item '${itemId}' to be defined in collection`)

	for (const [key, value] of Object.entries(expectedProperties)) {
		const actual = (item as Record<string, unknown>)[key]
		assert(
			isDeepStrictEqual(actual, value),
			`Expected item '${itemId}' property '${key}' to equal ${JSON.stringify(value)}, received ${JSON.stringify(actual)}`,
		)
	}
}

// =============================================================================
// Multi-User Comparison Assertions
// =============================================================================

/**
 * Assert that two collections have the same items (by ID)
 */
export function expectSameItems(collection1: AnyCollection, collection2: AnyCollection) {
	const ids1 = new Set([...collection1.values()].map((item: { id: string }) => item.id))
	const ids2 = new Set([...collection2.values()].map((item: { id: string }) => item.id))

	assert(
		isDeepStrictEqual(ids1, ids2),
		`Expected collections to contain the same item ids. Left: [${[...ids1].join(', ')}], right: [${[...ids2].join(', ')}]`,
	)
}

/**
 * Assert that two collections have NO overlapping items (by ID)
 */
export function expectNoOverlap(collection1: AnyCollection, collection2: AnyCollection) {
	const ids1 = new Set([...collection1.values()].map((item: { id: string }) => item.id))
	const ids2 = new Set([...collection2.values()].map((item: { id: string }) => item.id))

	const overlap = [...ids1].filter((id) => ids2.has(id))
	assert(overlap.length === 0, `Expected no overlapping item ids between collections, found: [${overlap.join(', ')}]`)
}

/**
 * Assert that collection1 is a subset of collection2 (by ID)
 */
export function expectSubset(subset: AnyCollection, superset: AnyCollection) {
	const subsetIds = [...subset.values()].map((item: { id: string }) => item.id)
	const supersetIds = new Set([...superset.values()].map((item: { id: string }) => item.id))

	for (const id of subsetIds) {
		assert(supersetIds.has(id), `Expected superset collection to contain item '${id}'`)
	}
}

// =============================================================================
// Sync Verification
// =============================================================================

/**
 * Subscribe to a collection and wait for it to be ready.
 * Returns an unsubscribe function.
 */
export async function subscribeAndWaitReady(collection: AnyCollection, opts?: WaitOptions): Promise<() => void> {
	const unsubscribe = collection.subscribeChanges(() => {})
	await waitForReady(collection, opts)
	return unsubscribe
}

/**
 * Full setup for a live query collection:
 * 1. Wait for underlying Electric collection to be ready
 * 2. Subscribe to live query collection
 * 3. Wait for live query collection to be ready
 *
 * Returns an unsubscribe function.
 */
export async function setupLiveQuery(
	electricCollection: AnyCollection,
	liveCollection: AnyCollection,
	opts?: WaitOptions,
): Promise<() => void> {
	// Wait for Electric collection to connect
	await waitForReady(electricCollection, opts)

	// Subscribe to live query
	const unsubscribe = liveCollection.subscribeChanges(() => {})

	// Wait for live query to process initial data
	await waitForReady(liveCollection, opts)

	// EXPERIMENT: Testing delay threshold
	// NO DELAY for hypothesis testing
	// await sleep(5)

	return unsubscribe
}
