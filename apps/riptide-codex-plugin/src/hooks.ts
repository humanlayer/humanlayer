// Codex's hooks, as this plugin uses them. Every hook is an `mcp_tool` hook: Codex calls the
// unlisted `codex_hook` tool on this plugin's own MCP server, over the connection it already has,
// with the event's fields filled into the input below. The tool's text answer is read as the
// hook's output, as a command hook's stdout would be. OpenAI's bundled browser plugin works the
// same way.
//
// A placeholder for a field the event lacks fails the hook, so each event names only the fields
// Codex documents for it. SessionEnd takes no mcp_tool hook, and comes after Codex has stopped the
// server: a command hook (cli.ts session-end) sends what the server had no time for.

/** The tool every hook calls. Left out of tools/list, so the model never sees it. */
export const HOOK_TOOL = 'codex_hook'

/** The server name in .mcp.json; Codex names its tools `mcp__humanlayer__<tool>`. */
export const SERVER = 'humanlayer'

const COMMON = ['hook_event_name', 'session_id', 'transcript_path', 'cwd', 'model'] as const

const FIELDS = {
	SessionStart: ['source'],
	UserPromptSubmit: ['turn_id', 'prompt'],
	PreToolUse: ['turn_id', 'tool_name', 'tool_use_id', 'tool_input'],
	PermissionRequest: ['turn_id', 'tool_name', 'tool_input'],
	PostToolUse: ['turn_id', 'tool_name', 'tool_use_id', 'tool_input', 'tool_response'],
	PreCompact: ['turn_id', 'trigger'],
	PostCompact: ['turn_id', 'trigger'],
	Stop: ['turn_id', 'stop_hook_active'],
	Interrupt: ['turn_id'],
	SubagentStart: ['turn_id', 'agent_id', 'agent_type'],
	SubagentStop: ['turn_id', 'agent_id', 'agent_type', 'agent_transcript_path'],
} as const

export type HookEventName = keyof typeof FIELDS

/** What the hook tool receives: the common fields, and the event's own. */
export interface HookInput {
	hook_event_name: HookEventName
	session_id: string
	transcript_path: string | null
	cwd: string
	model?: string
	source?: 'startup' | 'resume' | 'clear' | 'compact'
	turn_id?: string
	prompt?: string
	tool_name?: string
	tool_use_id?: string
	tool_input?: unknown
	tool_response?: unknown
	trigger?: 'manual' | 'auto'
	stop_hook_active?: boolean
	agent_id?: string
	agent_type?: string
	agent_transcript_path?: string | null
}

/** The hook tool's arguments as a HookInput, or undefined when they are not one. */
export function parseHookInput(args: Record<string, unknown>): HookInput | undefined {
	const event = args.hook_event_name
	if (typeof event !== 'string' || !(event in FIELDS) || typeof args.session_id !== 'string') return undefined
	if (typeof args.cwd !== 'string') return undefined
	const transcript = args.transcript_path
	const input: HookInput = {
		hook_event_name: event as HookEventName,
		session_id: args.session_id,
		transcript_path: typeof transcript === 'string' ? transcript : null,
		cwd: args.cwd,
	}
	const text = ['model', 'turn_id', 'prompt', 'tool_name', 'tool_use_id', 'agent_id', 'agent_type'] as const
	for (const key of text) if (typeof args[key] === 'string') input[key] = args[key]
	if (args.source === 'startup' || args.source === 'resume' || args.source === 'clear' || args.source === 'compact')
		input.source = args.source
	if (args.trigger === 'manual' || args.trigger === 'auto') input.trigger = args.trigger
	if (typeof args.stop_hook_active === 'boolean') input.stop_hook_active = args.stop_hook_active
	if ('tool_input' in args) input.tool_input = args.tool_input
	if ('tool_response' in args) input.tool_response = args.tool_response
	return input
}

/** Shown in Codex while the hook runs. */
const STATUS: Partial<Record<HookEventName, string>> = {
	PermissionRequest: 'Waiting for an answer in HumanLayer (Esc stops the turn)',
}

/** Seconds Codex waits for the hook. An approval waits on a person; Codex caps Interrupt at 3. */
const TIMEOUT: Partial<Record<HookEventName, number>> = { PermissionRequest: 600, Interrupt: 3 }

/** One hook handler in the manifest: a call to this server's hook tool. */
interface McpToolHook {
	type: 'mcp_tool'
	server: string
	tool: string
	/** Each field as a `${field}` placeholder Codex fills from the event. */
	input: Record<string, string>
	timeout: number
	statusMessage?: string
}

/** The SessionEnd hook: a command, since SessionEnd takes no mcp_tool hook. */
interface CommandHook {
	type: 'command'
	command: string
	timeout: number
}

type Manifest = Partial<Record<HookEventName | 'SessionEnd', { hooks: (McpToolHook | CommandHook)[] }[]>>

/** The `hooks` object for .codex-plugin/plugin.json. */
export function hooksManifest(): { hooks: Manifest } {
	const hooks: Manifest = {}
	for (const [event, fields] of Object.entries(FIELDS) as [HookEventName, readonly string[]][]) {
		const input = Object.fromEntries([...COMMON, ...fields].map((f) => [f, `\${${f}}`]))
		const handler: McpToolHook = {
			type: 'mcp_tool',
			server: SERVER,
			tool: HOOK_TOOL,
			input,
			timeout: TIMEOUT[event] ?? 30,
		}
		const status = STATUS[event]
		if (status) handler.statusMessage = status
		hooks[event] = [{ hooks: [handler] }]
	}
	// Codex waits for it, up to 3 s: the time to send what the stopped server could not.
	hooks.SessionEnd = [{ hooks: [{ type: 'command', command: 'node "$PLUGIN_ROOT/cli.js" session-end', timeout: 3 }] }]
	return { hooks }
}

/** What a hook answers, in the fields this plugin uses. Codex reads it as JSON; `{}` changes nothing. */
export interface HookOutput {
	/** false ends the turn (Stop). */
	continue?: boolean
	stopReason?: string
	/** A notice Codex shows the user. */
	systemMessage?: string
	/** PostToolUse: replaces the tool's result with reason. */
	decision?: 'block'
	reason?: string
	hookSpecificOutput?:
		| { hookEventName: 'SessionStart' | 'UserPromptSubmit'; additionalContext: string }
		| { hookEventName: 'PreToolUse'; permissionDecision: 'deny'; permissionDecisionReason: string }
		| { hookEventName: 'PermissionRequest'; decision: { behavior: 'allow' | 'deny'; message?: string } }
}

export function addContext(event: 'SessionStart' | 'UserPromptSubmit', text: string): HookOutput {
	return { hookSpecificOutput: { hookEventName: event, additionalContext: text } }
}

export function denyTool(reason: string): HookOutput {
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: reason,
		},
	}
}

export function permission(behavior: 'allow' | 'deny', message?: string): HookOutput {
	const decision: { behavior: 'allow' | 'deny'; message?: string } = { behavior }
	if (message) decision.message = message
	return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
}
