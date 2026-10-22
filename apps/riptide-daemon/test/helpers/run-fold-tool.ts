import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { layerCodingToolServices } from '@humanlayer/fold-agent'
import {
	AgentId,
	CurrentAgent,
	CurrentToolCall,
	InterruptNote,
	StopController,
	ToolCallId,
	ToolEvents,
	ToolState,
	type FoldTool,
} from '@humanlayer/fold-core'
import { Effect, Layer } from 'effect'

import type { FoldHostServices } from '@/effects/services/fold-sessions/fold-host-services'

const FoldToolTestServices = Layer.mergeAll(
	layerCodingToolServices({ outputDirectory: join(tmpdir(), 'run-fold-tool-output') }),
	Layer.succeed(ToolState, { get: () => Effect.succeed(null), set: () => Effect.void }),
	Layer.succeed(ToolEvents, { emit: () => Effect.void }),
	Layer.succeed(StopController, {
		requestStop: () => Effect.void,
		isStopRequested: Effect.succeed(false),
	}),
	Layer.succeed(CurrentAgent, {
		agentId: AgentId.make('agent_aaaaaaaaaaaaaaaaaaaaaaaa'),
		parentAgentId: null,
	}),
	Layer.succeed(CurrentToolCall, {
		toolCallId: ToolCallId.make('tool_call_aaaaaaaaaaaaaaaaaaaaaaaa'),
	}),
	Layer.succeed(InterruptNote, { set: () => Effect.void }),
)

export const runFoldTool = (input: {
	readonly tool: FoldTool<FoldHostServices>
	readonly parameters: unknown
}): Effect.Effect<unknown, unknown> =>
	input.tool.init.pipe(
		Effect.flatMap((contribution) => contribution.handler(input.parameters)),
		Effect.provide(FoldToolTestServices),
		Effect.scoped,
	)
