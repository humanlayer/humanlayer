import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Session } from '@humanlayer/db/tables/sessions'

import { getBundledAgents } from '@/agents/claudecode/bundled-agents'
import type { EffectiveSettings } from '@/agents/claudecode/effective-settings'
import { mapToSdkPermissionMode } from '@/agents/claudecode/permission-mode'
import type { ForkMeta } from '@/agents/shared/run-session'

export const CLAUDE_TOOLS = [
	'Agent',
	'ListAgents',
	'SendMessage',
	'Monitor',
	'Workflow',
	'Bash',
	'Edit',
	'Read',
	'Write',
	'Glob',
	'Grep',
	'TodoWrite',
	'ToolSearch',
	'WebSearch',
	'WebFetch',
	'Skill',
] as const

export function resolveModelForSdk(model: string | null | undefined): string {
	if (model === 'opus-1m') return 'opus'
	if (model === 'claude-opus-4-8-1m' || model === 'claude-opus-4-8[1m]') return 'claude-opus-4-8'
	if (model === 'claude-opus-4-7-1m' || model === 'claude-opus-4-7[1m]') return 'claude-opus-4-7'
	if (model === 'claude-opus-4-6-1m') return 'claude-opus-4-6[1m]'
	return model ?? 'opus'
}

export interface BuildClaudeQueryOptionsInput {
	readonly session: Session
	readonly effectiveSettings: EffectiveSettings
	readonly pathToClaudeCodeExecutable: string
	readonly cwd: string
	readonly rpiPluginPath: string
	readonly humanlayerPluginPath?: string
	readonly additionalDirectories: string[]
	readonly systemPromptAdditions: string[]
	readonly resumeSessionId?: string
	readonly forkMeta?: ForkMeta
	readonly mcpServers?: Options['mcpServers']
	readonly hooks?: Options['hooks']
	readonly canUseTool?: Options['canUseTool']
	readonly stderr?: Options['stderr']
	readonly commitAttributionEnv?: Record<string, string>
	readonly inheritedEnv: NodeJS.ProcessEnv
}

/** Models that reject `budget_tokens` thinking and only run adaptive thinking. */
const ADAPTIVE_ONLY_CLAUDE_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

/** Derives the complete SDK option value without acquiring any run resources. */
export function buildClaudeQueryOptions(input: BuildClaudeQueryOptionsInput): Options {
	const claudeForkMeta = input.forkMeta?.agent === 'claude' ? input.forkMeta : undefined
	if (input.forkMeta && !claudeForkMeta) {
		throw new Error('Claude execution received non-Claude fork metadata')
	}

	const effort = (input.session.effort ?? undefined) as Options['effort']
	const thinking: Options['thinking'] =
		input.session.model !== null && ADAPTIVE_ONLY_CLAUDE_MODELS.has(input.session.model)
			? { type: 'adaptive' }
			: { type: 'enabled', budgetTokens: 31999, display: 'summarized' }
	const plugins: NonNullable<Options['plugins']> = [{ type: 'local', path: input.rpiPluginPath }]
	if (input.humanlayerPluginPath) {
		plugins.push({ type: 'local', path: input.humanlayerPluginPath })
	}
	return {
		pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
		resume: claudeForkMeta?.forkFromCodingAgentSessionId ?? input.resumeSessionId,
		forkSession: claudeForkMeta ? true : undefined,
		resumeSessionAt: claudeForkMeta?.forkAtCodingAgentEventId,
		model: resolveModelForSdk(input.session.model),
		thinking,
		effort,
		cwd: input.cwd,
		mcpServers: input.mcpServers,
		additionalDirectories: input.additionalDirectories,
		allowDangerouslySkipPermissions: true,
		permissionMode: mapToSdkPermissionMode(input.session.permissions_mode),
		settingSources: ['user', 'project', 'local'],
		agents: getBundledAgents(input.effectiveSettings),
		includePartialMessages: true,
		// Relay subagent text/thinking and depth-2+ subagent messages, keyed by
		// their spawning Agent tool_use id. Off, nested Agent calls render empty.
		forwardSubagentText: true,
		env: {
			CLAUDE_CODE_EFFORT_LEVEL: effort ?? 'high',
			CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
			CLAUDE_CODE_DISABLE_CRON: '1',
			CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
			CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
			ENABLE_TOOL_SEARCH: 'auto:5',
			CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '0',
			CLAUDE_AGENT_SDK_MCP_NO_PREFIX: '0',
			CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1',
			CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS: '20000',
			MCP_CONNECTION_NONBLOCKING: '0',
			CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH: '1',
			...input.inheritedEnv,
			...input.commitAttributionEnv,
		},
		systemPrompt: {
			type: 'preset',
			preset: 'claude_code',
			append: input.systemPromptAdditions.join('\n'),
		},
		tools: [...CLAUDE_TOOLS],
		allowedTools: ['Grep', 'Glob', 'Skill'],
		stderr: input.stderr,
		canUseTool: input.canUseTool,
		plugins,
		hooks: input.hooks,
	}
}
