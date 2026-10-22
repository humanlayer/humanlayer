import { describe, expect, test } from 'vitest'

import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'

import {
	createCodingAgentAuthService,
	latestProviderLogins,
	type ProviderLoginRow,
	resolveAgentAuth,
} from './coding-agent-auth'

const host = { id: 'host-1', isColocated: false }
const localHost = { ...host, isColocated: true }
const ready: AgentConnection = {
	agent: 'codex',
	status: 'ready',
	path: '/bin/codex',
	version: '1',
	installationSource: 'unknown',
	checkedAt: 1,
}
const request = (overrides: Partial<ProviderLoginRow> = {}): ProviderLoginRow => ({
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
	...overrides,
})

describe('coding agent auth', () => {
	test('scopes sign-ins to host and provider', () => {
		expect(resolveAgentAuth(host, 'codex', [request()], [])).toBe('sign-in-succeeded')
		expect(resolveAgentAuth(host, 'claude', [request()], [])).toBe('unknown')
		expect(resolveAgentAuth({ ...host, id: 'host-2' }, 'codex', [request()], [])).toBe('unknown')
	})

	test.each(['failed', 'cancelled', 'requested', 'awaiting_approval'] as const)(
		'only the latest request counts when it is %s',
		(status) => {
			const rows = [request({ status, created_at: 2n }), request()]
			expect(resolveAgentAuth(host, 'codex', rows, [])).toBe('unknown')
			expect(latestProviderLogins(rows, host.id).get('codex')?.status).toBe(status)
		},
	)

	test('a newer success applies to both CodeLayer and Fold', () => {
		const rows = [request({ status: 'failed' }), request({ created_at: 2n })]
		expect(resolveAgentAuth(host, 'codex', rows, [], 'codelayer')).toBe('sign-in-succeeded')
		expect(resolveAgentAuth(host, 'codex', rows, [], 'fold')).toBe('sign-in-succeeded')
	})

	test('local readiness is scoped to the colocated host and compatible harness', () => {
		expect(resolveAgentAuth(localHost, 'codex', [], [ready])).toBe('local-ready')
		expect(resolveAgentAuth(host, 'codex', [], [ready])).toBe('unknown')
		expect(resolveAgentAuth(localHost, 'codex', [], [ready], 'fold')).toBe('unknown')
		expect(resolveAgentAuth(localHost, 'claude', [], [ready])).toBe('unknown')
	})

	test('a verified local check takes precedence over request history', () => {
		expect(resolveAgentAuth(localHost, 'codex', [request({ status: 'failed' })], [ready])).toBe('local-ready')
	})

	test('the service reads sources at action time rather than capturing a snapshot', () => {
		let rows: ProviderLoginRow[] = []
		let connections: AgentConnection[] = []
		const service = createCodingAgentAuthService({ requests: () => rows, connections: () => connections })
		expect(service.getState(host, 'codex')).toBe('unknown')
		rows = [request()]
		expect(service.getState(host, 'codex')).toBe('sign-in-succeeded')
		rows = []
		connections = [ready]
		expect(service.getState(localHost, 'codex')).toBe('local-ready')
	})
})
