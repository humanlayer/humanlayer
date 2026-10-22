import type { AgentProbeResult, ClaudeDiagnostic, ProbeCodingAgentInput } from '@humanlayer/riptide-electron-rpc'

import { electronClientRuntime } from '@/effects/electron-rpc/electron-client-runtime'
import { ElectronRpcClient } from '@/effects/electron-rpc/electron-rpc-client.service'

export function updateCli(): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.UpdateCli()))
}

export function checkClaudeInstalled(): Promise<ClaudeDiagnostic> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.CheckClaudeInstalled()))
}

export function updateClaudeCode(): Promise<void> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.UpdateClaudeCode()))
}

export function probeCodingAgent(input: ProbeCodingAgentInput): Promise<AgentProbeResult> {
	return electronClientRuntime.runPromise(ElectronRpcClient.use((client) => client.ProbeCodingAgent(input)))
}
