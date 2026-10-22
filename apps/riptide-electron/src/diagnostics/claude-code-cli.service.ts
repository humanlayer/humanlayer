import type {
	AgentProbeResult,
	CheckClaudeInstalledError,
	ClaudeDiagnostic,
	ProbeCodingAgentInput,
	UpdateClaudeCodeError,
} from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import type * as Effect from 'effect/Effect'

export class ClaudeCodeCliProcessFailure extends Data.TaggedError('ClaudeCodeCliProcessFailure')<{
	readonly operation: 'load_environment' | 'resolve' | 'check' | 'update'
	readonly cause: unknown
	readonly message: string
}> {}

export interface ClaudeCodeCliShape {
	readonly checkInstallation: Effect.Effect<ClaudeDiagnostic, CheckClaudeInstalledError>
	readonly updateToLatest: Effect.Effect<void, UpdateClaudeCodeError>
	readonly probeAgent: (input: ProbeCodingAgentInput) => Effect.Effect<AgentProbeResult>
}

export class ClaudeCodeCli extends Context.Service<ClaudeCodeCli, ClaudeCodeCliShape>()('ClaudeCodeCli') {}
