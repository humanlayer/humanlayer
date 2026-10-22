import type { PostToolUseHook } from '@humanlayer/agentlayer-core'

import { recordAttributedAgentActivity } from '@/lib/git/commit-attribution'

/**
 * Commit-attribution capture for codelayer (AgentLayer) sessions — the in-process twin of the
 * Claude SDK event-stream capture (claude-sessions workflows/process-events).
 *
 * Every tool call is one `recordAttributedAgentActivity` (the daemon policy adapter: gate
 * re-check, cwd normalization, fire-and-forget): file-writing tool inputs fold into the
 * session's authorship journal (powering the INFERRED tier when a human later commits the
 * agent's work), and an over-horizon session gets reported (the CONFIRMED-tier trailer stamping stays armed
 * while the agent is demonstrably active). The tool-name/input shapes
 * (`write`/`edit`/`multiedit`/`apply_patch`) are handled inside @humanlayer/git-attribution, so a
 * codelayer edit and the identical Claude Code edit produce identical line hashes.
 *
 * Best-effort by contract: never blocks or fails the tool call.
 */
export function createCodelayerCommitAttributionHook(input: {
	readonly sessionId: string
	readonly cwd: string
}): PostToolUseHook {
	return (context) => {
		recordAttributedAgentActivity({
			workingDirectory: input.cwd,
			sessionId: input.sessionId,
			toolName: context.toolName,
			toolInput: context.input,
		})
		return context.done()
	}
}
