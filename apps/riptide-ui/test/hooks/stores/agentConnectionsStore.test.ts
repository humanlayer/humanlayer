import { beforeEach, describe, expect, test } from 'vitest'

import {
	AGENT_CONNECTIONS_STORAGE_KEY,
	AGENT_CONNECTIONS_STORE_VERSION,
	migrateAgentConnectionsStore,
	useAgentConnectionsStore,
} from '../../../src/hooks/stores/agentConnectionsStore'
import type { AgentProbeResult } from '../../../src/integrations/desktop/diagnostics'

const readyClaude: AgentProbeResult = {
	status: 'ready',
	agent: 'claude',
	path: '/Users/dev/.local/bin/claude',
	version: '2.1.177 (Claude Code)',
	installationSource: 'native',
	checkedAt: 1_723_456_789_000,
}

describe('useAgentConnectionsStore', () => {
	beforeEach(() => {
		useAgentConnectionsStore.setState({
			agentConnections: [
				{
					status: 'not_checked',
					agent: 'claude',
					path: null,
					version: null,
					installationSource: null,
					checkedAt: null,
				},
			],
			skippedOptionalAgents: [],
			dismissedInstallationAdvice: {},
			lastVerifiedClaudePath: null,
		})
	})

	test('persists probe results through the store action', () => {
		useAgentConnectionsStore.getState().recordProbeResult(readyClaude)

		expect(useAgentConnectionsStore.getState().agentConnections).toEqual([readyClaude])
		expect(JSON.parse(localStorage.getItem(AGENT_CONNECTIONS_STORAGE_KEY) ?? '{}')).toEqual({
			state: {
				agentConnections: [readyClaude],
				skippedOptionalAgents: [],
				dismissedInstallationAdvice: {},
				lastVerifiedClaudePath: readyClaude.path,
			},
			version: AGENT_CONNECTIONS_STORE_VERSION,
		})
	})

	test('retains the last verified Claude path while a recheck fails', () => {
		useAgentConnectionsStore.getState().recordProbeResult(readyClaude)
		useAgentConnectionsStore.getState().recordProbeResult({
			status: 'failed',
			agent: 'claude',
			path: readyClaude.path,
			version: readyClaude.version,
			installationSource: readyClaude.installationSource,
			failure: { reason: 'smoke_test_failed', details: 'Model unavailable' },
			checkedAt: readyClaude.checkedAt + 1,
		})

		expect(useAgentConnectionsStore.getState().lastVerifiedClaudePath).toBe(readyClaude.path)

		useAgentConnectionsStore.getState().recordProbeResult({
			...readyClaude,
			path: '/Users/dev/.local/bin/claude-new',
			checkedAt: readyClaude.checkedAt + 2,
		})

		expect(useAgentConnectionsStore.getState().lastVerifiedClaudePath).toBe('/Users/dev/.local/bin/claude-new')
	})

	test('keeps one completed result per agent', () => {
		useAgentConnectionsStore.getState().recordProbeResult(readyClaude)
		useAgentConnectionsStore.getState().recordProbeResult({
			status: 'failed',
			agent: 'codex',
			path: null,
			version: null,
			installationSource: null,
			failure: { reason: 'not_found', details: 'Codex not found' },
			checkedAt: 1_723_456_790_000,
		})

		expect(useAgentConnectionsStore.getState().agentConnections).toMatchObject([
			{ agent: 'claude', status: 'ready', path: readyClaude.path },
			{ agent: 'codex', status: 'failed' },
		])
	})

	test('persists optional-agent skips and install-source advice dismissals', () => {
		useAgentConnectionsStore.getState().skipOptionalAgent('codex')
		useAgentConnectionsStore.getState().dismissInstallationAdvice('claude', 'homebrew')

		expect(useAgentConnectionsStore.getState()).toMatchObject({
			skippedOptionalAgents: ['codex'],
			dismissedInstallationAdvice: { claude: 'homebrew' },
		})
	})
})

describe('agent connection store migration', () => {
	test('adds the required Claude connection when old state is empty', () => {
		const migrated = migrateAgentConnectionsStore({ agentConnections: [] })
		expect(migrated.agentConnections).toMatchObject([{ agent: 'claude', status: 'not_checked' }])
		expect(migrated.skippedOptionalAgents).toEqual([])
		expect(migrated.dismissedInstallationAdvice).toEqual({})
	})

	test('retries an interrupted legacy check without persisting its in-progress state', () => {
		const migrated = migrateAgentConnectionsStore({
			agentConnections: [
				{
					status: 'checking',
					agent: 'claude',
					preferredPath: '/saved/claude',
					path: null,
					version: null,
					installationSource: null,
					checkedAt: null,
				},
			],
		})

		expect(migrated.agentConnections).toMatchObject([{ agent: 'claude', status: 'not_checked' }])
	})

	test('preserves valid probe results and drops invalid old entries', () => {
		const migrated = migrateAgentConnectionsStore({
			agentConnections: [{ stale: true }, readyClaude],
		})

		expect(migrated.agentConnections).toEqual([readyClaude])
	})

	test('rechecks legacy Codex connections against the HumanLayer CLI', () => {
		const migrated = migrateAgentConnectionsStore(
			{
				agentConnections: [
					{
						status: 'ready',
						agent: 'codex',
						path: '/Users/dev/.local/bin/codex',
						version: '0.147.0',
						installationSource: 'npm',
						checkedAt: 1_723_456_789_000,
					},
				],
			},
			3,
		)

		expect(migrated.agentConnections).toEqual([
			{
				status: 'not_checked',
				agent: 'codex',
				path: null,
				version: null,
				installationSource: null,
				checkedAt: null,
			},
		])
	})
})
