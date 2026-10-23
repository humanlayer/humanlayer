import { CollectionHealthTracker } from '@humanlayer/sync'
import { QueryClient } from '@tanstack/query-core'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createDiffCommentsCollection } from '@/collections/electric/diff-comments'
import {
	createQueryDiffCommentsCollection,
	destroyQueryDiffCommentsCollection,
} from '@/collections/query/diff-comments'

describe('diff comment collections', () => {
	afterEach(() => {
		destroyQueryDiffCommentsCollection('user-1', 'org-1')
	})

	test('creates an Electric collection from the canonical database schema', () => {
		const collection = createDiffCommentsCollection({
			syncOrigin: 'http://localhost:3000',
			tokenFetcher: async () => 'token',
			shouldRetryOnFailure: false,
			tracker: new CollectionHealthTracker({ collections: ['diffComments'] }),
			syncVersion: 2,
			logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
			captureException: vi.fn(),
		})

		expect(collection).toBeDefined()
		expect(collection.createIndex).toBeTypeOf('function')
		collection.cleanup()
	})

	test('creates a query fallback collection for the diff comment sync route', () => {
		const row = {
			id: crypto.randomUUID(),
			organization_id: crypto.randomUUID(),
			resource_owner_user_id: 'owner',
			task_id: crypto.randomUUID(),
			created_by_user_id: 'author',
			reply_to_comment_id: null,
			created_at: 100n,
			updated_at: 200n,
			content_text: 'Comment',
			content_json: null,
			anchor_json: null,
			is_resolved: false,
			resolved_by_user_id: null,
			is_deleted: false,
			created_by_agent: false,
		}
		const procedure = vi.fn(async () => ({ rows: [row] }))
		const apiClient = { sync: { v2: { diffComments: procedure } } }
		const collection = createQueryDiffCommentsCollection({
			apiClient: apiClient as never,
			tracker: new CollectionHealthTracker({ collections: ['diffComments'] }),
			queryClient: new QueryClient(),
			syncVersion: 2,
			captureException: vi.fn(),
		})

		expect(collection).toBeDefined()
		expect(collection.utils.refetch).toBeTypeOf('function')
		collection.cleanup()
	})
})
