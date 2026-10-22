// mapper.ts: opencode's session events to HumanLayer events and usage, with no I/O.

import assert from 'node:assert/strict'
import test from 'node:test'

import type { OpenCodeEvent } from '@opencode/client/promise'

import { createMapperState, mapEvent, mapPrompt, promptText, shapeToolCall } from '../src/mapper.ts'

const CWD = '/repo'

function event(type: string, data: Record<string, unknown>, id = `evt_${type}`): OpenCodeEvent {
	const value: unknown = { id, type, created: 0, data: { sessionID: 'ses_1', ...data } }
	return value as OpenCodeEvent
}

function state() {
	const s = createMapperState('ses_1', CWD)
	s.model = 'claude-haiku-4-5'
	return s
}

test('text and reasoning map once each, when they end', () => {
	const s = state()
	const text = event('session.text.ended', { assistantMessageID: 'msg_1', ordinal: 0, text: 'hello' })
	const first = mapEvent(text, s)
	assert.equal(first.events.length, 1)
	assert.equal(first.events[0]?.role, 'assistant')
	assert.equal(first.events[0]?.content, 'hello')
	assert.equal(first.events[0]?.codingAgentEventId, 'msg_1:text:0')
	assert.equal(mapEvent(text, s).events.length, 0, 'seen twice, sent once')

	const thinking = mapEvent(
		event('session.reasoning.ended', { assistantMessageID: 'msg_1', ordinal: 1, text: 'hmm' }),
		s,
	)
	assert.equal(thinking.events[0]?.eventType, 'thinking')
	assert.equal(
		mapEvent(event('session.text.ended', { assistantMessageID: 'm', ordinal: 0, text: '  ' }), s).events.length,
		0,
	)
})

test('the same event and state give the same event ids', () => {
	const e = event('session.text.ended', { assistantMessageID: 'msg_1', ordinal: 0, text: 'hello' })
	assert.equal(mapEvent(e, state()).events[0]?.eventId, mapEvent(e, state()).events[0]?.eventId)
})

test('a tool call takes its name from the input stream, with Claude Code key names and absolute paths', () => {
	const s = state()
	mapEvent(event('session.tool.input.started', { id: 'call_1', name: 'edit' }), s)
	const call = mapEvent(
		event('session.tool.called', { id: 'call_1', input: { filePath: 'src/a.ts', oldString: 'a', newString: 'b' } }),
		s,
	)
	assert.equal(call.events[0]?.toolName, 'edit')
	assert.deepEqual(call.events[0]?.toolInputJson, { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
	assert.ok(s.openTools.has('call_1'))

	const result = mapEvent(
		event('session.tool.success', { id: 'call_1', content: [{ type: 'text', text: 'done' }] }),
		s,
	)
	assert.equal(result.events[0]?.toolResultForId, 'call_1')
	assert.equal(result.events[0]?.toolResultContent, 'done')
	assert.deepEqual(result.touched, ['/repo/src/a.ts'])
	assert.equal(s.openTools.size, 0)
})

test('a failed tool leads with its error, and touches nothing', () => {
	const s = state()
	mapEvent(event('session.tool.input.started', { id: 'c', name: 'write' }), s)
	mapEvent(event('session.tool.called', { id: 'c', input: { filePath: '/repo/x' } }), s)
	const out = mapEvent(
		event('session.tool.failed', { id: 'c', content: [], error: { type: 'x', message: 'denied' } }),
		s,
	)
	assert.equal(out.events[0]?.toolResultContent, 'denied')
	assert.equal(out.touched, undefined)
})

test('a tool stopped while its input streamed gets its call before its result', () => {
	const s = state()
	mapEvent(event('session.tool.input.started', { id: 'c', name: 'write' }), s)
	const failed = { id: 'c', content: [], error: { type: 'x', message: 'Tool execution interrupted' } }
	const out = mapEvent(event('session.tool.failed', failed), s)
	assert.deepEqual(
		out.events.map((e) => [e.eventType, e.toolName ?? e.toolResultContent]),
		[
			['tool_call', 'write'],
			['tool_result', 'Tool execution interrupted'],
		],
	)
})

test('shell results lead with a failing exit code, and ask for a task folder scan', () => {
	const s = state()
	mapEvent(event('session.tool.input.started', { id: 'b', name: 'shell' }), s)
	const call = mapEvent(event('session.tool.called', { id: 'b', input: { command: 'false', timeout: 5 } }), s)
	assert.equal(call.events[0]?.toolName, 'bash')
	assert.deepEqual(call.events[0]?.toolInputJson, { command: 'false', timeout_ms: 5 })
	const out = mapEvent(
		event('session.tool.success', { id: 'b', content: [{ type: 'text', text: 'oops' }], metadata: { exit: 1 } }),
		s,
	)
	assert.equal(out.events[0]?.toolResultContent, 'Exit code 1\noops')
	assert.equal(out.scan, true)
})

test("a user's own shell command becomes a bash call and its result", () => {
	const out = mapEvent(
		event('session.shell.ended', {
			shell: { id: 'sh_1', command: 'ls', exit: 2, status: 'exited' },
			output: { output: 'no such file' },
		}),
		state(),
	)
	assert.deepEqual(
		out.events.map((e) => [e.eventType, e.toolName ?? e.toolResultContent]),
		[
			['tool_call', 'bash'],
			['tool_result', 'Exit code 2\nno such file'],
		],
	)
	assert.equal(out.scan, true)
})

test('tool names match the web app views', () => {
	assert.equal(shapeToolCall('glob', {}, CWD)[0], 'Glob')
	assert.equal(shapeToolCall('list', {}, CWD)[0], 'LS')
	assert.equal(shapeToolCall('task', {}, CWD)[0], 'Task')
	assert.deepEqual(shapeToolCall('subagent', { agent: 'general', description: 'd', prompt: 'p' }, CWD), [
		'Task',
		{ subagent_type: 'general', description: 'd', prompt: 'p' },
	])
	assert.deepEqual(shapeToolCall('grep', { pattern: 'x', include: '*.ts' }, CWD), [
		'Grep',
		{ pattern: 'x', glob: '*.ts' },
	])
	assert.deepEqual(shapeToolCall('read', { path: 'a' }, CWD)[1], { path: 'a', file_path: '/repo/a' })
	assert.equal(shapeToolCall('get_artifact_comments', {}, CWD)[0], 'mcp__humanlayer__get_artifact_comments')
})

test('a finished step reports usage once, under the model, with the files it wrote', () => {
	const s = state()
	const step = event(
		'session.step.ended',
		{ tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 3 } }, cost: 0.01, files: ['a.ts'] },
		'evt_step_1',
	)
	const out = mapEvent(step, s)
	assert.deepEqual(out.usage, {
		usageReportKey: 'evt_step_1',
		contextWindowTokens: 120,
		totalCostUsd: 0.01,
		modelUsage: {
			'claude-haiku-4-5': {
				input_tokens: 10,
				output_tokens: 7,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 3,
			},
		},
	})
	assert.deepEqual(out.touched, ['/repo/a.ts'])
	assert.equal(mapEvent(step, s).usage, undefined)
	const empty = event('session.step.ended', {
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		cost: 0,
	})
	assert.equal(mapEvent(empty, state()).usage, undefined, 'zeros would empty the context gauge')
})

test('a failed step is an error message, but an interrupted one is not', () => {
	const failed = mapEvent(
		event('session.step.failed', { assistantMessageID: 'm', error: { type: 'api', message: 'overloaded' } }),
		state(),
	)
	assert.equal(failed.errorMessage, 'overloaded')
	assert.equal(failed.events[0]?.content, '**Error:** overloaded')

	const stopped = mapEvent(
		event('session.step.failed', { assistantMessageID: 'm', error: { type: 'x', message: 'Step interrupted' } }),
		state(),
	)
	assert.equal(stopped.events.length, 0)
	assert.equal(stopped.errorMessage, undefined)
})

test('a compaction is a boundary and a summary that points to it', () => {
	const s = state()
	const start = mapEvent(event('session.compaction.started', { reason: 'manual' }, 'evt_c1'), s)
	const end = mapEvent(event('session.compaction.ended', { text: 'the summary' }, 'evt_c2'), s)
	const boundary = JSON.parse(String(start.events[0]?.content)) as { kind: string; trigger: string }
	const summary = JSON.parse(String(end.events[0]?.content)) as { boundaryEventId: string; summary: string }
	assert.deepEqual([boundary.kind, boundary.trigger], ['context_compaction', 'manual'])
	assert.equal(summary.boundaryEventId, start.events[0]?.eventId)
	assert.equal(summary.summary, 'the summary')
})

test('prompts: attached files show as placeholders, and a prompt maps once', () => {
	assert.equal(promptText({ text: 'look', files: [{}, {}] }), 'look\n[file]\n[file]')
	const s = state()
	assert.equal(mapPrompt('msg_9', 'again', s).events[0]?.content, 'again')
	assert.equal(mapPrompt('msg_9', 'again', s).events.length, 0)
})
