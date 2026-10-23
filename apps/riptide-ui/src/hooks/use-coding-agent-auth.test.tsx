import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import type { ProviderLoginRow } from '@/services/coding-agent-auth'

import { useCodingAgentAuth, useCodingAgentAuthService } from './use-coding-agent-auth'

const sync = vi.hoisted(() => ({ collection: null as unknown }))
vi.mock('@/components/providers/SyncProvider', () => ({
	useSync: () => ({ providerLoginRequestsCollection: sync.collection }),
}))

let collection: ReturnType<typeof createRequests>
function createRequests() {
	return createCollection(localOnlyCollectionOptions<ProviderLoginRow>({ getKey: (row) => row.id, gcTime: 0 }))
}

beforeEach(() => {
	collection = createRequests()
	sync.collection = collection
	useAgentConnectionsStore.setState({
		agentConnections: [
			{
				agent: 'codex',
				status: 'not_checked',
				path: null,
				version: null,
				installationSource: null,
				checkedAt: null,
			},
		],
	})
})

afterEach(async () => {
	cleanup()
	await waitFor(() => expect(collection.subscriberCount).toBe(0))
	await collection.cleanup()
})

test('reactive reads and action-time reads agree as sign-ins and host selection change', async () => {
	const { result, rerender } = renderHook(
		({ hostId }) => ({
			auth: useCodingAgentAuth({ id: hostId, isColocated: false }, 'codex'),
			service: useCodingAgentAuthService(),
		}),
		{ initialProps: { hostId: 'host-1' } },
	)
	const row: ProviderLoginRow = {
		id: 'request-1',
		organization_id: 'org-1',
		user_id: 'user-1',
		host_id: 'host-1',
		provider: 'codex',
		method: 'device',
		status: 'requested',
		url: null,
		user_code: null,
		submitted_code: null,
		error: null,
		account_label: null,
		expires_at: 100n,
		created_at: 1n,
		updated_at: 1n,
	}
	act(() => {
		collection.insert(row)
	})
	expect(result.current.auth.isSignedIn).toBe(false)
	act(() => {
		collection.update(row.id, (draft) => {
			draft.status = 'succeeded'
		})
	})
	await waitFor(() => expect(result.current.auth.state).toBe('sign-in-succeeded'))
	expect(result.current.service.getState({ id: 'host-1', isColocated: false }, 'codex')).toBe(
		result.current.auth.state,
	)
	rerender({ hostId: 'host-2' })
	await waitFor(() => expect(result.current.auth.isSignedIn).toBe(false))
})

test('local checks update reactively without making remote hosts ready', async () => {
	const { result, rerender } = renderHook(
		({ isColocated }) => useCodingAgentAuth({ id: 'host-1', isColocated }, 'codex'),
		{ initialProps: { isColocated: true } },
	)
	expect(result.current.isSignedIn).toBe(false)
	act(() =>
		useAgentConnectionsStore.getState().recordProbeResult({
			agent: 'codex',
			status: 'ready',
			path: '/bin/codex',
			version: '1',
			installationSource: 'unknown',
			checkedAt: 1,
		}),
	)
	await waitFor(() => expect(result.current.state).toBe('local-ready'))
	rerender({ isColocated: false })
	expect(result.current.isSignedIn).toBe(false)
})
