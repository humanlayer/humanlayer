import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { BasicIndex } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'

import { createBrowserElectricCollection } from '../src/browser-electric-collection.ts'
import { CollectionHealthTracker } from '../src/health-tracker.ts'
import type { BrowserCollectionDeps } from '../src/index.ts'

function createDeps(overrides: Partial<BrowserCollectionDeps> = {}): BrowserCollectionDeps {
	return {
		syncOrigin: 'http://localhost:3000',
		tokenFetcher: async () => 'test-token',
		shouldRetryOnFailure: true,
		tracker: new CollectionHealthTracker({ collections: ['sessions'] }),
		syncVersion: 2,
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
		captureException: vi.fn(),
		...overrides,
	}
}

function waitForStatus(collection: { status: string }, targetStatus: string, timeoutMs = 1000): Promise<void> {
	return new Promise((resolve, reject) => {
		if (collection.status === targetStatus) {
			resolve()
			return
		}
		const start = Date.now()
		const check = () => {
			if (collection.status === targetStatus) {
				resolve()
			} else if (Date.now() - start > timeoutMs) {
				reject(new Error(`Timeout waiting for status '${targetStatus}', got '${collection.status}'`))
			} else {
				setTimeout(check, 10)
			}
		}
		check()
	})
}

describe('createBrowserElectricCollection', () => {
	test('returns create and get methods', () => {
		const builder = createBrowserElectricCollection({
			schema: sessionSelectSchema,
			routePath: '/sessions',
			collectionName: 'sessions',
		})

		expect(builder.create).toBeTypeOf('function')
		expect(builder.get).toBeTypeOf('function')
	})

	test('create produces a collection and registers configured indexes', () => {
		const builder = createBrowserElectricCollection({
			schema: sessionSelectSchema,
			routePath: '/sessions',
			collectionName: 'sessions',
			indexes: [{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex }],
		})

		const collection = builder.create(createDeps())

		expect(collection).toBeDefined()
		expect(collection.createIndex).toBeTypeOf('function')
	})

	test('get returns cached collection for the same identity and sync version', () => {
		const builder = createBrowserElectricCollection({
			schema: sessionSelectSchema,
			routePath: '/sessions',
			collectionName: 'sessions',
		})
		const deps = createDeps()

		const first = builder.get('user-1', 'org-1', deps, false)
		const second = builder.get('user-1', 'org-1', deps, false)

		expect(second).toBe(first)
	})

	test('get returns different collections for different cache identities', () => {
		const builder = createBrowserElectricCollection({
			schema: sessionSelectSchema,
			routePath: '/sessions',
			collectionName: 'sessions',
		})
		const deps = createDeps()

		const first = builder.get('user-1', 'org-1', deps, false)
		const second = builder.get('user-2', 'org-1', deps, false)

		expect(second).not.toBe(first)
	})

	test('get skips cache while auth state is loading', () => {
		const builder = createBrowserElectricCollection({
			schema: sessionSelectSchema,
			routePath: '/sessions',
			collectionName: 'sessions',
		})
		const deps = createDeps()

		const loadingCollection = builder.get('user-1', 'org-1', deps, true)
		const cachedCollection = builder.get('user-1', 'org-1', deps, false)

		expect(cachedCollection).not.toBe(loadingCollection)
	})

	describe('collection cleanup', () => {
		test('cleans up previous collection when user changes', async () => {
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps()

			const first = builder.get('user-1', 'org-1', deps, false)
			expect(first.status).not.toBe('cleaned-up')

			// Different user triggers new collection, old one should be cleaned up
			const second = builder.get('user-2', 'org-1', deps, false)
			expect(second).not.toBe(first)

			// First collection should transition to cleaned-up
			await waitForStatus(first, 'cleaned-up')
			expect(first.status).toBe('cleaned-up')
		})

		test('cleans up loading collection when auth completes', async () => {
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps()

			// Simulate auth loading state - creates uncached collection
			const loadingCollection = builder.get(null, null, deps, true)
			expect(loadingCollection.status).not.toBe('cleaned-up')

			// Auth completes - creates cached collection, should cleanup loading one
			const authedCollection = builder.get('user-1', 'org-1', deps, false)
			expect(authedCollection).not.toBe(loadingCollection)

			await waitForStatus(loadingCollection, 'cleaned-up')
			expect(loadingCollection.status).toBe('cleaned-up')
		})

		test('does not cleanup when returning same cached collection', () => {
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps()

			const first = builder.get('user-1', 'org-1', deps, false)
			const initialStatus = first.status

			// Same cache key should return same collection, no cleanup
			const second = builder.get('user-1', 'org-1', deps, false)

			expect(second).toBe(first)
			expect(first.status).toBe(initialStatus) // Status unchanged
		})

		test('cleans up all previous collections in rapid succession', async () => {
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps()

			// Create 5 collections rapidly with different users
			const collections = []
			for (let i = 0; i < 5; i++) {
				collections.push(builder.get(`user-${i}`, 'org-1', deps, false))
			}

			// All but the last should be cleaned up
			for (let i = 0; i < 4; i++) {
				await waitForStatus(collections[i], 'cleaned-up')
				expect(collections[i].status).toBe('cleaned-up')
			}

			// Last one should still be active
			expect(collections[4].status).not.toBe('cleaned-up')
		})

		test('logs when collection starts syncing', () => {
			const infoMock = vi.fn()
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps({
				logger: { debug: vi.fn(), info: infoMock, warn: vi.fn(), error: vi.fn() } as any,
			})

			builder.get('user-1', 'org-1', deps, false)

			const startedCall = infoMock.mock.calls.find((call) => call[0]?.includes('started syncing'))
			expect(startedCall).toBeDefined()
			expect(startedCall[0]).toContain('sessions')
		})

		test('logs when cleaning up previous collection', async () => {
			const infoMock = vi.fn()
			const builder = createBrowserElectricCollection({
				schema: sessionSelectSchema,
				routePath: '/sessions',
				collectionName: 'sessions',
			})
			const deps = createDeps({
				logger: { debug: vi.fn(), info: infoMock, warn: vi.fn(), error: vi.fn() } as any,
			})

			builder.get('user-1', 'org-1', deps, false)
			builder.get('user-2', 'org-1', deps, false)

			const cleanupCall = infoMock.mock.calls.find((call) => call[0]?.includes('Cleaning up'))
			expect(cleanupCall).toBeDefined()
			expect(cleanupCall[0]).toContain('sessions')
		})
	})
})
