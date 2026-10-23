import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const ClaudeInstallationSource = Schema.Literals(['native', 'homebrew', 'nvm', 'npm', 'bun', 'other'])
export type ClaudeInstallationSource = typeof ClaudeInstallationSource.Type

export const ClaudeDiagnostic = Schema.Struct({
	path: Schema.String,
	version: Schema.String,
	installationSource: ClaudeInstallationSource,
	isRecommendedPath: Schema.Boolean,
	isVersionSupported: Schema.Boolean,
})
export type ClaudeDiagnostic = typeof ClaudeDiagnostic.Type

export const CodingAgent = Schema.Literals(['claude', 'codex'])
export type CodingAgent = typeof CodingAgent.Type

export const ProbeCodingAgentInput = Schema.Struct({
	agent: CodingAgent,
	preferredPath: Schema.NullOr(Schema.String),
})
export type ProbeCodingAgentInput = typeof ProbeCodingAgentInput.Type

export const AgentProbeFailure = Schema.Union([
	Schema.Struct({ reason: Schema.tag('not_found'), details: Schema.String }),
	Schema.Struct({ reason: Schema.tag('unsupported_version'), details: Schema.String }),
	Schema.Struct({ reason: Schema.tag('authentication_required'), details: Schema.String }),
	Schema.Struct({ reason: Schema.tag('smoke_test_failed'), details: Schema.String }),
	Schema.Struct({ reason: Schema.tag('timed_out'), details: Schema.String }),
])
export type AgentProbeFailure = typeof AgentProbeFailure.Type

export const AgentProbeResult = Schema.Union([
	Schema.Struct({
		status: Schema.tag('ready'),
		agent: CodingAgent,
		path: Schema.String,
		version: Schema.String,
		installationSource: Schema.String,
		checkedAt: Schema.Number,
	}),
	Schema.Struct({
		status: Schema.tag('failed'),
		agent: CodingAgent,
		path: Schema.NullOr(Schema.String),
		version: Schema.NullOr(Schema.String),
		installationSource: Schema.NullOr(Schema.String),
		failure: AgentProbeFailure,
		checkedAt: Schema.Number,
	}),
])
export type AgentProbeResult = typeof AgentProbeResult.Type

export class ClaudeNotFoundError extends Schema.TaggedError<ClaudeNotFoundError>()('ClaudeNotFoundError', {
	message: Schema.String,
}) {}

export class ClaudeCheckError extends Schema.TaggedError<ClaudeCheckError>()('ClaudeCheckError', {
	message: Schema.String,
}) {}

export class ClaudeUpdateError extends Schema.TaggedError<ClaudeUpdateError>()('ClaudeUpdateError', {
	message: Schema.String,
}) {}

export const CheckClaudeInstalledError = Schema.Union([ClaudeNotFoundError, ClaudeCheckError])
export type CheckClaudeInstalledError = typeof CheckClaudeInstalledError.Type

export const UpdateClaudeCodeError = Schema.Union([ClaudeNotFoundError, ClaudeUpdateError])
export type UpdateClaudeCodeError = typeof UpdateClaudeCodeError.Type

export class UpdateCli extends Rpc.make('UpdateCli', {
	success: Schema.Void,
}) {}

export class CheckClaudeInstalled extends Rpc.make('CheckClaudeInstalled', {
	success: ClaudeDiagnostic,
	error: CheckClaudeInstalledError,
}) {}

export class UpdateClaudeCode extends Rpc.make('UpdateClaudeCode', {
	success: Schema.Void,
	error: UpdateClaudeCodeError,
}) {}

export class ProbeCodingAgent extends Rpc.make('ProbeCodingAgent', {
	payload: ProbeCodingAgentInput.fields,
	success: AgentProbeResult,
}) {}
