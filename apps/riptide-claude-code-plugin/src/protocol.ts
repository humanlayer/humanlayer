// What the plugin's two halves say to each other. The mod (hooks/mod.ts) runs inside Claude Code
// with no Node: it sees prompts, turns, tool calls and approvals, and is the only part that can
// steer the session. The server (server.ts) is the plugin's MCP server, a Node child of Claude
// Code: it signs in, mirrors, syncs and follows the web app. The mod calls the server over HTTP on
// a Unix socket (`run/<Claude Code pid>.sock`); the server answers, and hands the mod work to do
// through the long poll on /actions. Types only: the mod imports nothing at run time.

/** POST /hello: once per process, and again when the session id changes (/clear, a resume). */
export interface Hello {
	sessionId: string
	cwd: string
	transcriptPath?: string
	/** A person is at the prompt (false under `claude -p` and the Agent SDK). */
	interactive: boolean
	/** HUMANLAYER_PAT, which the mod then removes from Claude Code's environment. */
	pat?: string
	/** The variables the mod read for the server: the daemon's session markers, the task and the off switch. */
	env: {
		HUMANLAYER_SESSION_ID?: string
		HUMANLAYER_SESSION_URL?: string
		HUMANLAYER_TASK?: string
		HUMANLAYER_CHANNEL?: string
		HUMANLAYER_CLAUDE_DISABLE?: string
	}
}

export interface HelloReply {
	/** The plugin does nothing in this session: the HumanLayer daemon runs and mirrors it already. */
	disabled?: string
	/** The HumanLayer tools, for the mod to register as `mcp__humanlayer__<name>`. */
	tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[]
}

/** Where a prompt came from, in the mod's words. */
export type PromptOrigin = 'user' | 'web' | 'other'

/** POST /event. */
export type ModEvent =
	| { kind: 'prompt'; sessionId: string; text: string; origin: PromptOrigin; images: number; model?: string }
	| { kind: 'turn-start'; sessionId: string; turnId: string }
	| {
			kind: 'turn-end'
			sessionId: string
			turnId: string
			reason: 'answer' | 'aborted' | 'refusal' | 'error'
			/** The model's context window, when Claude Code knows it. */
			contextWindow?: number
	  }
	/** Claude Code stored transcript rows: the server reads the file now. */
	| { kind: 'rows'; sessionId: string }
	/** A tool call finished. File tools and Bash change the task folder and the diff. */
	| {
			kind: 'tool-done'
			sessionId: string
			toolUseId?: string
			tool: string
			input: Record<string, unknown>
			isError: boolean
			/** The tool's error text, which says whether the user denied it. */
			text?: string
	  }
	| { kind: 'session'; sessionId: string; transcriptPath?: string }
	/** A web message the mod could not start. */
	| { kind: 'web-failed'; sessionId: string; reason: string }
	| { kind: 'end'; sessionId: string; reason: string }

/** GET /actions: work the server hands the mod, in order. */
export type Action =
	/** A web message. `text` is the user's own words. */
	| { kind: 'submit'; sessionId: string; text: string }
	/** The web stop button. */
	| { kind: 'abort'; sessionId: string }
	| { kind: 'compact'; sessionId: string }
	/** A web message that names a slash command or skill. */
	| { kind: 'command'; sessionId: string; command: string; args: string }
	/** The footer. */
	| { kind: 'status'; text: string }
	/** A notice, shown once. */
	| { kind: 'toast'; text: string }

/**
 * POST /approval: Claude Code asks before a tool runs; the reply is `{ id }`. Then GET
 * /approval?id=&wait= until it is answered: `{ answer }`, or `{}` to ask again.
 */
export interface ApprovalAsk {
	sessionId: string
	toolUseId?: string
	tool: string
	input: Record<string, unknown>
	/** A subagent's call. */
	agentId?: string
}

/** `none`: the terminal answered first, or no one in HumanLayer will; the hook leaves it. */
export type ApprovalAnswer =
	| { behavior: 'allow' }
	| { behavior: 'deny'; message?: string; interrupt?: boolean }
	| { behavior: 'none' }

/** POST /command: `/humanlayer <args>`. */
export interface CommandAsk {
	sessionId: string
	args: string
}

/** POST /tool: one of the HumanLayer tools. */
export interface ToolAsk {
	sessionId: string
	name: string
	input: Record<string, unknown>
}

export interface TextReply {
	text: string
	isError?: boolean
}

/** POST /commands: the session's slash commands and skills, for the web composer. */
export interface CommandsReport {
	sessionId: string
	commands: { name: string; description?: string; kind?: string }[]
}
