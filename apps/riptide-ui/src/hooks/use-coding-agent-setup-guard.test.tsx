import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useCodingAgentSetupStore } from '@/hooks/stores/codingAgentSetupStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import type { ProviderLoginRow } from '@/services/coding-agent-auth'

import { useCodingAgentSetupGuard } from './use-coding-agent-setup-guard'

const host = { id: 'host-1', name: 'Build machine', isColocated: false }
const signIns = vi.hoisted(() => ({ rows: [] as ProviderLoginRow[] }))

vi.mock('@/components/providers/SyncProvider', () => ({
	useSync: () => ({
		providerLoginRequestsCollection: {
			get toArray() {
				return signIns.rows
			},
		},
	}),
}))

describe('useCodingAgentSetupGuard', () => {
	beforeEach(() => {
		useCodingAgentSetupStore.getState().close()
		useSettingsStore.setState({ codingAgentSetupAcknowledgements: {} })
		signIns.rows = []
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

	test('opens the matching setup variant before committing an unacknowledged Fold provider selection', () => {
		const onContinue = vi.fn()
		const { result } = renderHook(() => useCodingAgentSetupGuard())

		act(() => {
			result.current.guardSetup({ agent: 'fold', provider: 'xai', host, onContinue })
		})

		expect(onContinue).not.toHaveBeenCalled()
		expect(useCodingAgentSetupStore.getState()).toMatchObject({
			isOpen: true,
			target: { variant: { id: 'fold:xai' }, host },
		})
	})

	test('continues immediately only when that host and variant are acknowledged', () => {
		const onContinue = vi.fn()
		useSettingsStore.getState().setCodingAgentSetupAcknowledged(host.id, 'fold:xai', true)
		const { result } = renderHook(() => useCodingAgentSetupGuard())

		act(() => {
			result.current.guardSetup({ agent: 'fold', provider: 'xai', host, onContinue })
		})

		expect(onContinue).toHaveBeenCalledOnce()
		expect(useCodingAgentSetupStore.getState().isOpen).toBe(false)
	})

	test('reads the current local check when the action runs, scoped to CodeLayer on this host', () => {
		const { result } = renderHook(() => useCodingAgentSetupGuard())
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
		const onContinue = vi.fn()
		act(() =>
			result.current.guardSetup({
				agent: 'codelayer',
				provider: 'codex',
				host: { ...host, isColocated: true },
				onContinue,
			}),
		)
		expect(onContinue).toHaveBeenCalledOnce()
		act(() => result.current.guardSetup({ agent: 'codelayer', provider: 'codex', host, onContinue }))
		expect(onContinue).toHaveBeenCalledOnce()
		expect(useCodingAgentSetupStore.getState().isOpen).toBe(true)
		act(() =>
			result.current.guardSetup({
				agent: 'fold',
				provider: 'codex',
				host: { ...host, isColocated: true },
				onContinue,
			}),
		)
		expect(onContinue).toHaveBeenCalledOnce()
	})

	test('uses the latest host-scoped sign-in at action time', () => {
		const { result } = renderHook(() => useCodingAgentSetupGuard())
		const onContinue = vi.fn()
		const row: ProviderLoginRow = {
			id: 'request-1',
			organization_id: 'org-1',
			user_id: 'user-1',
			host_id: host.id,
			provider: 'codex',
			method: 'device',
			status: 'succeeded',
			url: null,
			user_code: null,
			submitted_code: null,
			error: null,
			account_label: null,
			expires_at: 100n,
			created_at: 1n,
			updated_at: 1n,
		}
		signIns.rows = [row]
		act(() => result.current.guardSetup({ agent: 'codelayer', provider: 'codex', host, onContinue }))
		expect(onContinue).toHaveBeenCalledOnce()
		expect(useCodingAgentSetupStore.getState().isOpen).toBe(false)
		signIns.rows.push({ ...row, id: 'request-2', status: 'failed', created_at: 2n })
		act(() => result.current.guardSetup({ agent: 'codelayer', provider: 'codex', host, onContinue }))
		expect(onContinue).toHaveBeenCalledOnce()
		expect(useCodingAgentSetupStore.getState().isOpen).toBe(true)
	})
})
