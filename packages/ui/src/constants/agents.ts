import type { LaunchableCodingAgent } from '@humanlayer/schemas/coding-agent'

import type { ProviderOption } from './providers'

export const AGENT_OPTIONS = [
	{ value: 'claude', label: 'Claude Code' },
	{ value: 'codelayer', label: 'Codex' },
] as const satisfies readonly { value: LaunchableCodingAgent; label: string }[]

export type AgentOption = LaunchableCodingAgent

export const AGENT_LABELS: Record<AgentOption, string> = Object.fromEntries(
	[...AGENT_OPTIONS, { value: 'fold', label: 'Fold' }].map((o) => [o.value, o.label]),
) as Record<AgentOption, string>

/** The task launchers expose one provider for each supported coding agent. */
export function launcherProviderForAgent(agent: AgentOption): ProviderOption {
	return agent === 'claude' ? 'anthropic' : 'codex'
}
