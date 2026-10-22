import type { CodingAgent } from '@/integrations/desktop/diagnostics'

type ProbeFailureReason =
	| 'not_found'
	| 'unsupported_version'
	| 'authentication_required'
	| 'smoke_test_failed'
	| 'timed_out'
	| undefined

export function getClaudeRepairCommand(
	failureReason: ProbeFailureReason,
	installationSource: string | null | undefined,
): string {
	if (failureReason === 'authentication_required') return 'claude /login'
	if (failureReason === 'not_found') return 'curl -fsSL https://claude.ai/install.sh | bash'
	if (failureReason === 'unsupported_version') {
		if (installationSource === 'homebrew') return 'brew upgrade --cask claude-code'
		if (installationSource === 'npm' || installationSource === 'nvm') {
			return 'npm install -g @anthropic-ai/claude-code@latest'
		}
		if (installationSource === 'bun') return 'bun add -g @anthropic-ai/claude-code@latest'
		return 'claude update'
	}
	return 'claude -p hi --model haiku'
}

export function getProbeFailureSummary(agent: CodingAgent, failureReason: ProbeFailureReason): string {
	if (failureReason === 'authentication_required') {
		return `${agent === 'claude' ? 'Claude' : 'Codex'} needs you to sign in.`
	}
	if (failureReason === 'not_found') {
		return agent === 'claude'
			? 'Claude was not found on this device.'
			: 'HumanLayer CLI was not found in your shell.'
	}
	if (failureReason === 'unsupported_version') {
		return `${agent === 'claude' ? 'Claude' : 'HumanLayer CLI'} needs to be updated.`
	}
	if (failureReason === 'timed_out') {
		return `${agent === 'claude' ? 'Claude' : 'Codex'} took too long to respond.`
	}
	return `${agent === 'claude' ? 'Claude' : 'Codex'} did not complete the device check.`
}
