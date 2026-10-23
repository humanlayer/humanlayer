import type { AgentProbeResult, ProbeCodingAgentInput } from '@humanlayer/riptide-electron-rpc'
import { describe, expect, it } from 'vitest'

import { makeDesktopDiagnostics } from '@/integrations/desktop/diagnostics'

const diagnostic = {
	path: '/Users/test/.local/bin/claude',
	version: '2.1.177',
	installation_source: 'native',
	is_recommended: true,
	is_version_supported: true,
}

const probeResult: AgentProbeResult = {
	status: 'ready',
	agent: 'claude',
	path: '/Users/test/.local/bin/claude',
	version: '2.1.177',
	installationSource: 'native',
	checkedAt: 42,
}

const makeAdapter = (name: string, calls: string[]) => ({
	updateCli: async () => {
		calls.push(`${name}:update-cli`)
	},
	checkClaudeInstalled: async () => {
		calls.push(`${name}:check-claude`)
		return diagnostic
	},
	updateClaudeCode: async () => {
		calls.push(`${name}:update-claude`)
	},
	probeCodingAgent: async (input: ProbeCodingAgentInput) => {
		calls.push(`${name}:probe:${input.agent}:${input.preferredPath ?? 'auto'}`)
		return probeResult
	},
})

describe('desktop diagnostics dispatch', () => {
	it('dispatches every basic operation to Electron without entering Tauri', async () => {
		const calls: string[] = []
		const integration = makeDesktopDiagnostics({
			runtime: { isElectron: () => true, isTauri: () => true },
			electron: makeAdapter('electron', calls),
			tauri: makeAdapter('tauri', calls),
		})

		await integration.updateCli()
		await integration.checkClaudeInstalled()
		await integration.updateClaudeCode()

		expect(calls).toEqual(['electron:update-cli', 'electron:check-claude', 'electron:update-claude'])
	})

	it('routes exact-path probes through Tauri', async () => {
		const calls: string[] = []
		const integration = makeDesktopDiagnostics({
			runtime: { isElectron: () => false, isTauri: () => true },
			electron: makeAdapter('electron', calls),
			tauri: makeAdapter('tauri', calls),
		})

		await expect(
			integration.probeCodingAgent({ agent: 'claude', preferredPath: diagnostic.path }),
		).resolves.toEqual(probeResult)
		expect(calls).toEqual([`tauri:probe:claude:${diagnostic.path}`])
	})

	it('routes coding-agent probes through Electron', async () => {
		const calls: string[] = []
		const integration = makeDesktopDiagnostics({
			runtime: { isElectron: () => true, isTauri: () => false },
			electron: makeAdapter('electron', calls),
			tauri: makeAdapter('tauri', calls),
		})

		await expect(integration.probeCodingAgent({ agent: 'claude', preferredPath: null })).resolves.toEqual(
			probeResult,
		)
		expect(calls).toEqual(['electron:probe:claude:auto'])
	})

	it('uses safe browser fallbacks', async () => {
		const calls: string[] = []
		const integration = makeDesktopDiagnostics({
			runtime: { isElectron: () => false, isTauri: () => false },
			electron: makeAdapter('electron', calls),
			tauri: makeAdapter('tauri', calls),
		})

		await integration.updateCli()
		await integration.updateClaudeCode()
		await expect(integration.checkClaudeInstalled()).rejects.toThrow('require the native app')
		await expect(integration.probeCodingAgent({ agent: 'claude', preferredPath: null })).rejects.toThrow(
			'Coding-agent probes are not available in this host',
		)
		expect(calls).toEqual([])
	})
})
