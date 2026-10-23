import { invoke } from '@tauri-apps/api/core'

import { isElectron, isTauri } from '@/lib/utils'

import * as electronDiagnostics from '../electron/diagnostics'
import {
	type ClaudeCheckResult,
	checkClaudeInstalled as checkTauriClaudeInstalled,
	probeCodingAgent as probeTauriCodingAgent,
	updateClaudeCode as updateTauriClaudeCode,
} from '../tauri/claude-diagnostics'

export type {
	AgentProbeFailure,
	AgentProbeResult,
	CodingAgent,
	ProbeCodingAgentInput,
} from '@humanlayer/riptide-electron-rpc'
import type { AgentProbeResult, ProbeCodingAgentInput } from '@humanlayer/riptide-electron-rpc'

interface DesktopDiagnosticsAdapter {
	readonly updateCli: () => Promise<void>
	readonly checkClaudeInstalled: () => Promise<ClaudeCheckResult>
	readonly updateClaudeCode: () => Promise<void>
	readonly probeCodingAgent: (input: ProbeCodingAgentInput) => Promise<AgentProbeResult>
}

interface DesktopDiagnosticsRuntime {
	readonly isElectron: () => boolean
	readonly isTauri: () => boolean
}

export const makeDesktopDiagnostics = (input: {
	readonly runtime: DesktopDiagnosticsRuntime
	readonly electron: DesktopDiagnosticsAdapter
	readonly tauri: DesktopDiagnosticsAdapter
}) => {
	const selectedAdapter = (): DesktopDiagnosticsAdapter | null => {
		if (input.runtime.isElectron()) return input.electron
		if (input.runtime.isTauri()) return input.tauri
		return null
	}

	return {
		updateCli: (): Promise<void> => selectedAdapter()?.updateCli() ?? Promise.resolve(),
		checkClaudeInstalled: (): Promise<ClaudeCheckResult> => {
			const adapter = selectedAdapter()
			return adapter === null
				? Promise.reject(new Error('Claude Code diagnostics require the native app'))
				: adapter.checkClaudeInstalled()
		},
		updateClaudeCode: (): Promise<void> => selectedAdapter()?.updateClaudeCode() ?? Promise.resolve(),
		probeCodingAgent: (probeInput: ProbeCodingAgentInput): Promise<AgentProbeResult> => {
			const adapter = selectedAdapter()
			return adapter === null
				? Promise.reject(new Error('Coding-agent probes are not available in this host'))
				: adapter.probeCodingAgent(probeInput)
		},
	}
}

const electronAdapter: DesktopDiagnosticsAdapter = {
	updateCli: electronDiagnostics.updateCli,
	checkClaudeInstalled: () =>
		electronDiagnostics.checkClaudeInstalled().then((result) => ({
			path: result.path,
			version: result.version,
			installation_source: result.installationSource,
			is_recommended: result.isRecommendedPath,
			is_version_supported: result.isVersionSupported,
		})),
	updateClaudeCode: electronDiagnostics.updateClaudeCode,
	probeCodingAgent: electronDiagnostics.probeCodingAgent,
}

const tauriAdapter: DesktopDiagnosticsAdapter = {
	updateCli: () => invoke('terminal_cli_self_update'),
	checkClaudeInstalled: checkTauriClaudeInstalled,
	updateClaudeCode: updateTauriClaudeCode,
	probeCodingAgent: probeTauriCodingAgent,
}

export const { updateCli, checkClaudeInstalled, updateClaudeCode, probeCodingAgent } = makeDesktopDiagnostics({
	runtime: { isElectron, isTauri },
	electron: electronAdapter,
	tauri: tauriAdapter,
})
