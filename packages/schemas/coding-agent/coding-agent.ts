import * as Schema from 'effect/Schema'
import z from 'zod/v4'

export const CODING_AGENT_VALUES = ['claude', 'opencode', 'codelayer', 'fold', 'pi', 'codex', 'claude-code'] as const

export const CodingAgentEffectSchema = Schema.Literals(CODING_AGENT_VALUES)
export type EffectCodingAgent = typeof CodingAgentEffectSchema.Type

export const CodingAgentZodSchema = z.enum(CODING_AGENT_VALUES)
export type ZodCodingAgent = z.infer<typeof CodingAgentZodSchema>

export type CodingAgent = EffectCodingAgent

/**
 * The coding agents the daemon can launch and continue today, and the only options the task
 * launchers offer. This list grows as agents become supported (opencode, pi, …); anything
 * absent is rejected by the daemon session handlers and hidden from the launcher. It is a strict
 * subset of CODING_AGENT_VALUES, enforced by `satisfies`.
 *
 * `fold` is exposed in launchers only while the default-off Fold experiment is enabled. The
 * daemon dispatches it to the Fold executor, while the default CodeLayer path remains Codex-only.
 */
export const LAUNCHABLE_CODING_AGENT_VALUES = ['claude', 'codelayer', 'fold'] as const satisfies readonly CodingAgent[]

/**
 * Whether the daemon runs this agent's sessions. A session it doesn't run (pi, opencode, codex) is
 * mirrored from the user's own terminal, which never reads model, effort or fast mode changes made
 * in the app.
 */
export function isLaunchableCodingAgent(agent: string | null | undefined): agent is LaunchableCodingAgent {
	return LAUNCHABLE_CODING_AGENT_VALUES.some((value) => value === agent)
}

export const LaunchableCodingAgentEffectSchema = Schema.Literals(LAUNCHABLE_CODING_AGENT_VALUES)
export type EffectLaunchableCodingAgent = typeof LaunchableCodingAgentEffectSchema.Type

export const LaunchableCodingAgentZodSchema = z.enum(LAUNCHABLE_CODING_AGENT_VALUES)
export type ZodLaunchableCodingAgent = z.infer<typeof LaunchableCodingAgentZodSchema>

export type LaunchableCodingAgent = EffectLaunchableCodingAgent
