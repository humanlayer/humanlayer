import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { BasicIndex } from '@tanstack/db'
import { QueryClient } from '@tanstack/query-core'
import { describe, expect, test, vi } from 'vitest'

import { createBrowserQueryCollection } from '../src/browser-query-collection.ts'
import { CollectionHealthTracker } from '../src/health-tracker.ts'
import type { BrowserQueryCollectionDeps } from '../src/index.ts'

function createDeps(overrides: Partial<BrowserQueryCollectionDeps> = {}): BrowserQueryCollectionDeps {
	return {
		apiClient: {},
		tracker: new CollectionHealthTracker({ collections: ['sessions'] }),
		queryClient: new QueryClient(),
		syncVersion: 2,
		captureException: vi.fn(),
		...overrides,
	}
}

describe('createBrowserQueryCollection', () => {
	test('returns create, get, and destroy methods', () => {
		const builder = createBrowserQueryCollection({
			collectionName: 'sessions',
			rowSchema: sessionSelectSchema,
			procedure: () => async () => ({ rows: [] }),
		})

		expect(builder.create).toBeTypeOf('function')
		expect(builder.get).toBeTypeOf('function')
		expect(builder.destroy).toBeTypeOf('function')
	})

	test('create produces a collection with configured indexes', () => {
		const builder = createBrowserQueryCollection({
			collectionName: 'sessions',
			rowSchema: sessionSelectSchema,
			procedure: () => async () => ({ rows: [] }),
			indexes: [{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex }],
		})

		const collection = builder.create(createDeps())

		expect(collection).toBeDefined()
		expect(collection.createIndex).toBeTypeOf('function')
	})

	test('get returns cached collection for the same identity and sync version', () => {
		const builder = createBrowserQueryCollection({
			collectionName: 'sessions',
			rowSchema: sessionSelectSchema,
			procedure: () => async () => ({ rows: [] }),
		})
		const deps = createDeps()

		const first = builder.get('user-1', 'org-1', deps)
		const second = builder.get('user-1', 'org-1', deps)

		expect(second).toBe(first)
	})

	test('destroy cleans up the cached collection', () => {
		const builder = createBrowserQueryCollection({
			collectionName: 'sessions',
			rowSchema: sessionSelectSchema,
			procedure: () => async () => ({ rows: [] }),
		})
		const deps = createDeps()
		const collection = builder.get('user-1', 'org-1', deps)
		const cleanup = vi.fn(() => undefined)
		collection.cleanup = cleanup

		builder.destroy('user-1', 'org-1', 2)

		expect(cleanup).toHaveBeenCalled()
	})
})
