import { codexModel } from '@humanlayer/fold-codex'
import {
	AgentId,
	EventId,
	type ActiveModel,
	type AgentStartedLogEntry,
	type ModelChangeLogEntry,
} from '@humanlayer/fold-core'

export const initialFoldModel = codexModel({ model: 'gpt-5.6-sol', reasoning: 'high' }).activeModel

export const modelStartedEntry = (
	agentId: typeof AgentId.Type,
	model: ActiveModel = initialFoldModel,
	seq = 0,
	parentAgentId: typeof AgentId.Type | null = null,
): AgentStartedLogEntry => ({
	_tag: 'agent_started',
	seq,
	eventId: EventId.create(),
	ts: seq,
	version: 1,
	agentId,
	parentAgentId,
	toolCallId: null,
	mode: 'fresh',
	model,
	tools: [],
	skill: null,
	fork: null,
	agentType: null,
})

export const modelChangedEntry = (
	agentId: typeof AgentId.Type,
	model: ActiveModel,
	seq: number,
): ModelChangeLogEntry => ({
	_tag: 'model-change',
	seq,
	eventId: EventId.create(),
	ts: seq,
	version: 1,
	agentId,
	parentAgentId: null,
	toolCallId: null,
	model,
	reason: 'test model change',
})
