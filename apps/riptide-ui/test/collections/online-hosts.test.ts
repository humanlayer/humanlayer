import { onlineHostSelectSchema, type OnlineHost } from '@humanlayer/db/tables/online-hosts'
import { CollectionHealthTracker } from '@humanlayer/sync'
import { QueryClient } from '@tanstack/query-core'
import { createLiveQueryCollection } from '@tanstack/react-db'
import { waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { createOnlineHostsCollection } from '@/collections/electric/online-hosts'
import { getOnlineHostKey } from '@/collections/online-host-key'
import { createQueryOnlineHostsCollection } from '@/collections/query/online-hosts'

const row: OnlineHost = {
	host_id: 'shared-host',
	organization_id: '00000000-0000-4000-8000-000000000001',
	user_id: 'user-1',
	host_name: 'workstation',
	last_seen: 1_800_000_000_000n,
	status: 'offline',
	daemon_version: '0.174.30',
	reports_repositories: true,
	capabilities: ['reportsRepositories', 'providerLogin'],
	distribution: 'cli',
	can_self_update: false,
	ephemeral: false,
	update_requested_version: null,
	update_state: null,
	update_error: null,
	machine: null,
	stats: null,
	coding_agent_usage_limits: null,
}

describe('online host collections', () => {
	test('the canonical row shape includes status and last_seen', () => {
		expect(onlineHostSelectSchema.parse(row)).toEqual(row)

		const electricCollection = createOnlineHostsCollection({
			syncOrigin: 'http://localhost:3000',
			tokenFetcher: async () => 'token',
			shouldRetryOnFailure: false,
			tracker: new CollectionHealthTracker({ collections: ['onlineHosts'] }),
			syncVersion: 2,
			logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
			captureException: vi.fn(),
		})
		const queryCollection = createQueryOnlineHostsCollection({
			apiClient: { sync: { v2: { onlineHosts: vi.fn(async () => ({ rows: [row] })) } } } as never,
			tracker: new CollectionHealthTracker({ collections: ['onlineHosts'] }),
			queryClient: new QueryClient(),
			syncVersion: 2,
			captureException: vi.fn(),
		})

		expect(electricCollection).toBeDefined()
		expect(queryCollection).toBeDefined()
		electricCollection.cleanup()
		queryCollection.cleanup()
	})

	test('uses different keys for every composite registration identity', () => {
		const sameHostOtherUser = { ...row, user_id: 'user-2' }
		const sameHostOtherOrganization = {
			...row,
			organization_id: '00000000-0000-4000-8000-000000000002',
		}

		expect(getOnlineHostKey(row)).not.toBe(getOnlineHostKey(sameHostOtherUser))
		expect(getOnlineHostKey(row)).not.toBe(getOnlineHostKey(sameHostOtherOrganization))
		expect(new Set([row, sameHostOtherUser, sameHostOtherOrganization].map(getOnlineHostKey))).toHaveLength(3)
	})

	test('query refetch reconciles an offline registration to online in place', async () => {
		let status: OnlineHost['status'] = 'offline'
		const collection = createQueryOnlineHostsCollection({
			apiClient: {
				sync: {
					v2: {
						onlineHosts: vi.fn(async () => ({ rows: [{ ...row, status }] })),
					},
				},
			} as never,
			tracker: new CollectionHealthTracker({ collections: ['onlineHosts'] }),
			queryClient: new QueryClient(),
			syncVersion: 2,
			captureException: vi.fn(),
		})
		const liveCollection = createLiveQueryCollection({
			query: (query) => query.from({ hosts: collection }),
			startSync: true,
		})

		await waitFor(() => expect(liveCollection.toArray).toEqual([expect.objectContaining({ status: 'offline' })]))

		status = 'online'
		await collection.utils.refetch()
		await waitFor(() => expect(liveCollection.toArray).toEqual([expect.objectContaining({ status: 'online' })]))
		expect(liveCollection.toArray[0]).toMatchObject({
			host_id: row.host_id,
			organization_id: row.organization_id,
			user_id: row.user_id,
		})

		liveCollection.cleanup()
		collection.cleanup()
	})
})
