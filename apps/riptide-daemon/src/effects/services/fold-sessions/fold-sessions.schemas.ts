import { AgentId, type FoldEvent, type LogEntry, LlmModelId, ReasoningLevel } from '@humanlayer/fold-core'
import { XaiFrontierModelId } from '@humanlayer/fold-xai'
import { FoldModelProvider } from '@humanlayer/schemas/model-provider'
import { Schema } from 'effect'

export const FoldSessionProvider = FoldModelProvider
export type FoldSessionProvider = Schema.Schema.Type<typeof FoldSessionProvider>

export const FoldSessionIdentity = Schema.Struct({
	sessionId: Schema.String,
	organizationId: Schema.String,
	hostId: Schema.String,
	taskId: Schema.NullOr(Schema.String),
	workingDirectory: Schema.String,
})
export interface FoldSessionIdentity extends Schema.Schema.Type<typeof FoldSessionIdentity> {}

export const FoldModelSelection = Schema.Union([
	Schema.Struct({
		provider: Schema.Literal('codex'),
		model: LlmModelId,
		reasoning: ReasoningLevel,
	}),
	Schema.Struct({
		provider: Schema.Literal('xai'),
		model: XaiFrontierModelId,
		reasoning: ReasoningLevel,
	}),
])
export type FoldModelSelection = typeof FoldModelSelection.Type

export const OpenFoldSessionInput = Schema.Struct({ sessionId: Schema.String })
export interface OpenFoldSessionInput extends Schema.Schema.Type<typeof OpenFoldSessionInput> {}

/**
 * How a prompt gains ownership when another prompt still holds the session. `serialize` waits
 * for the existing prompt to finish. `recover-lost` replaces it, because the database already
 * classified that run as lost. Omitted means `serialize`.
 */
export const FoldPromptAdmissionPolicy = Schema.Literals(['serialize', 'recover-lost'])
export type FoldPromptAdmissionPolicy = Schema.Schema.Type<typeof FoldPromptAdmissionPolicy>

export const RunFoldPromptInput = Schema.Struct({
	sessionId: Schema.String,
	prompt: Schema.String,
	admissionPolicy: Schema.optionalKey(FoldPromptAdmissionPolicy),
})
export interface RunFoldPromptInput extends Schema.Schema.Type<typeof RunFoldPromptInput> {}

export const InterruptFoldSessionInput = Schema.Struct({ sessionId: Schema.String })
export interface InterruptFoldSessionInput extends Schema.Schema.Type<typeof InterruptFoldSessionInput> {}

export const FoldSessionInterruptOutcome = Schema.Literals(['stopped', 'not-running', 'timed-out'])
export type FoldSessionInterruptOutcome = Schema.Schema.Type<typeof FoldSessionInterruptOutcome>

export interface ProcessFoldEventInput {
	readonly identity: FoldSessionIdentity
	/** Durable history through this event; includes persisted entries when resuming. */
	readonly history: ReadonlyArray<LogEntry>
	readonly rootAgentId: typeof AgentId.Type
	readonly event: FoldEvent
}
