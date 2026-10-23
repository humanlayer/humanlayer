import { invoke } from '@tauri-apps/api/core'

import type { AgentProbeResult, ProbeCodingAgentInput } from '@/integrations/desktop/diagnostics'

/**
 * Result of Claude Code installation check (raw shape from the native `claude_diagnostics.rs`
 * command — snake_case to match the Rust serde serialization).
 */
export interface ClaudeCheckResult {
	path: string
	version: string
	installation_source: string
	is_recommended: boolean
	is_version_supported: boolean
}

/**
 * Check Claude Code is installed and in PATH
 * @returns ClaudeCheckResult with path, version, and installation source info
 * @throws Error if Claude is not installed
 */
export async function checkClaudeInstalled(): Promise<ClaudeCheckResult> {
	return invoke<ClaudeCheckResult>('check_claude_installed')
}

export async function probeCodingAgent(input: ProbeCodingAgentInput): Promise<AgentProbeResult> {
	return invoke<AgentProbeResult>('probe_coding_agent', { input })
}

/**
 * Update Claude Code to the latest version by running `claude --update`
 * @throws Error if the update fails
 */
export async function updateClaudeCode(): Promise<void> {
	return invoke('update_claude_code')
}

/**
 * Fetch the latest published Claude Code version from the npm registry.
 *
 * Uses the abbreviated package-metadata endpoint (plain `fetch`, no Tauri
 * invoke) because it returns `Access-Control-Allow-Origin: *` and is therefore
 * reachable from the webview origin. The dedicated `/-/package/.../dist-tags`
 * endpoint is smaller but sends no CORS header, so a `fetch` from the renderer
 * is blocked. The `application/vnd.npm.install-v1+json` Accept header requests
 * the abbreviated document, which still carries `dist-tags`.
 * @returns the `latest` dist-tag version string
 * @throws Error if the registry is unreachable or the response is malformed
 */
export async function fetchLatestClaudeVersion(): Promise<string> {
	const res = await fetch('https://registry.npmjs.org/@anthropic-ai%2Fclaude-code', {
		headers: { Accept: 'application/vnd.npm.install-v1+json' },
	})
	if (!res.ok) {
		throw new Error(`Failed to fetch latest Claude Code version: ${res.status} ${res.statusText}`)
	}
	const json = (await res.json()) as { 'dist-tags'?: { latest?: string } }
	const latest = json['dist-tags']?.latest
	if (!latest) {
		throw new Error('Latest Claude Code version missing from npm registry response')
	}
	return latest
}
