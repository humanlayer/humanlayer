import type {
	Options,
	PermissionMode,
	SDKControlGetUsageResponse,
	SDKMessage,
	SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import { Context, type Effect, type Scope, type Stream } from 'effect'

import type { ClaudeSdkError } from './claude-sdk-error'

export interface OpenClaudeSdkSessionInput {
	readonly sessionId: string
	readonly prompt: string
	readonly options: Options
}

export interface ClaudeSdkSession {
	readonly output: Stream.Stream<SDKMessage, ClaudeSdkError>
	readonly input: {
		readonly sendMessage: (prompt: string) => Effect.Effect<void, ClaudeSdkError>
		readonly close: Effect.Effect<void>
	}
	readonly controls: {
		readonly interrupt: Effect.Effect<void, ClaudeSdkError>
		readonly setModel: (model: string) => Effect.Effect<void, ClaudeSdkError>
		readonly setPermissionMode: (mode: PermissionMode) => Effect.Effect<void, ClaudeSdkError>
		// `system/init` carries bare command names; only this control request returns
		// descriptions and argument hints.
		readonly supportedCommands: Effect.Effect<ReadonlyArray<SlashCommand>, ClaudeSdkError>
		/** The SDK's `/usage` snapshot; undefined when the SDK build cannot produce one. */
		readonly readUsage: Effect.Effect<SDKControlGetUsageResponse | undefined, ClaudeSdkError>
	}
	readonly markCompleted: Effect.Effect<void>
}

export class ClaudeSdk extends Context.Service<
	ClaudeSdk,
	{
		readonly open: (
			input: OpenClaudeSdkSessionInput,
		) => Effect.Effect<ClaudeSdkSession, ClaudeSdkError, Scope.Scope>
	}
>()('ClaudeSdk') {}
