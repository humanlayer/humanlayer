// Pure unit tests for src/mapper.ts (plan.md §5.2-§5.4): every entry row, every tool shaping rule,
// the size limits, deterministic ids, and the state that flows between entries. Entries are typed
// literals, so no pi runtime is needed.

import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { AssistantMessage, JsonObject, Usage } from '@earendil-works/pi-ai'
import type { SessionEntry, SessionMessageEntry } from '@earendil-works/pi-coding-agent'
import { eventUuid as nameUuid } from '@humanlayer/session-sdk-sessions'

import {
	type CloudEvent,
	createMapperState,
	type MapperState,
	mapEntry,
	resolveToCwd,
	systemEvent,
} from '../src/mapper.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MB = 1024 * 1024
const CWD = '/work/repo'
const TAIL = /…\[truncated \d+ bytes\]$/

const usage: Usage = {
	input: 10,
	output: 20,
	cacheRead: 300,
	cacheWrite: 4,
	totalTokens: 334,
	cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.004, total: 0.334 },
}

const base = (id: string) => ({ id, parentId: null, timestamp: '2026-09-27T00:00:00.000Z' })

function message(id: string, message: SessionMessageEntry['message']): SessionEntry {
	return { type: 'message', ...base(id), message }
}

function user(id: string, content: string): SessionEntry {
	return message(id, { role: 'user', content, timestamp: 1 })
}

type Blocks = AssistantMessage['content']

function assistant(id: string, content: Blocks, extra: Partial<AssistantMessage> = {}): SessionEntry {
	const fields = { api: 'anthropic-messages', provider: 'anthropic', model: 'claude-test', usage, timestamp: 1 }
	return message(id, { role: 'assistant', content, stopReason: 'stop', ...fields, ...extra })
}

function toolCall(id: string, name: string, args: JsonObject): Blocks[number] {
	return { type: 'toolCall', id, name, arguments: args }
}

function toolResult(id: string, toolCallId: string, toolName: string, text: string, isError = false): SessionEntry {
	const content = [{ type: 'text' as const, text }]
	return message(id, { role: 'toolResult', toolCallId, toolName, content, isError, timestamp: 1 })
}

function bashRun(id: string, exitCode: number | undefined, cancelled = false): SessionEntry {
	const fields = { command: 'make test', output: 'out', truncated: false, timestamp: 1 }
	return message(id, { role: 'bashExecution', exitCode, cancelled, ...fields })
}

const newState = (): MapperState => createMapperState('pi-session-1', CWD)

function only(entry: SessionEntry, state = newState()): CloudEvent {
	const { events } = mapEntry(entry, state)
	assert.equal(events.length, 1)
	return events[0]!
}

function parse(event: CloudEvent | undefined): unknown {
	return JSON.parse(event?.content ?? 'null')
}

test('user message: text parts joined, images as [image], with deterministic uuid ids', () => {
	const content = [
		{ type: 'text' as const, text: 'look' },
		{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' },
		{ type: 'text' as const, text: 'here' },
	]
	const entry = message('u1', { role: 'user', content, timestamp: 1 })
	const event = only(entry)
	assert.deepEqual(event, {
		eventId: nameUuid('pi-session-1:u1:0'),
		codingAgentSessionId: 'pi-session-1',
		codingAgentEventId: 'u1:0',
		eventType: 'message',
		role: 'user',
		content: 'look\n[image]\nhere',
	})
	assert.match(event.eventId, UUID)
	assert.deepEqual(only(entry), event) // same entry, same event
	assert.notEqual(only(entry, createMapperState('pi-session-2', CWD)).eventId, event.eventId)
	assert.equal(only(user('u2', 'plain')).content, 'plain')
})

test('skipFirstUser drops the next user message only, then clears', () => {
	const state = newState()
	state.skipFirstUser = true
	only({ type: 'model_change', ...base('m1'), provider: 'anthropic', modelId: 'claude-test' }, state)
	assert.equal(state.skipFirstUser, true)
	assert.deepEqual(mapEntry(user('u1', 'first'), state), { events: [] })
	assert.equal(state.skipFirstUser, false)
	assert.equal(only(user('u2', 'second'), state).content, 'second')
})

test('assistant: an event per block in order, tokens on the first, usage, and toolCalls state', () => {
	const state = newState()
	const entry = assistant('a1', [
		{ type: 'thinking', thinking: '' },
		{ type: 'thinking', thinking: 'opaque', redacted: true },
		{ type: 'thinking', thinking: 'plan' },
		{ type: 'text', text: 'Hello' },
		{ type: 'text', text: ' \n' },
		toolCall('call_1', 'grep', { pattern: 'x' }),
	])
	const out = mapEntry(entry, state)
	assert.deepEqual(
		out.events.map((e) => [e.codingAgentEventId, e.eventType, e.role, e.content ?? e.toolInputJson, e.toolName]),
		[
			['a1:0', 'thinking', 'assistant', 'plan', undefined],
			['a1:1', 'message', 'assistant', 'Hello', undefined],
			['a1:2', 'tool_call', 'assistant', { pattern: 'x' }, 'grep'],
		],
	)
	assert.deepEqual(
		out.events.map((e) => e.toolCallId),
		[undefined, undefined, 'call_1'],
	)
	assert.deepEqual(
		out.events.map((e) => [e.inputTokens, e.outputTokens]),
		[
			[314, 20],
			[undefined, undefined],
			[undefined, undefined],
		],
	)
	assert.deepEqual(out.usage, {
		usageReportKey: 'a1',
		contextWindowTokens: 334,
		totalCostUsd: 0.334,
		modelUsage: {
			'claude-test': {
				input_tokens: 10,
				output_tokens: 20,
				cache_read_input_tokens: 300,
				cache_creation_input_tokens: 4,
			},
		},
	})
	assert.equal(out.errorMessage, undefined)
	assert.equal(out.touched, undefined)
	assert.deepEqual([...state.toolCalls], [['call_1', { name: 'grep', args: { pattern: 'x' } }]])
})

test('assistant error: an **Error:** message, errorMessage set, and usage still returned', () => {
	const failed = mapEntry(
		assistant('a2', [{ type: 'text', text: 'partial' }], { stopReason: 'error', errorMessage: 'overloaded' }),
		newState(),
	)
	assert.deepEqual(
		failed.events.map((e) => [e.codingAgentEventId, e.eventType, e.role, e.content]),
		[
			['a2:0', 'message', 'assistant', 'partial'],
			['a2:1', 'message', 'assistant', '**Error:** overloaded'],
		],
	)
	assert.equal(failed.errorMessage, 'overloaded')
	assert.equal(failed.usage?.usageReportKey, 'a2')

	// With no content, the error event is the first one, so it carries the tokens.
	const alone = only(assistant('a3', [], { stopReason: 'error', errorMessage: 'rate limited' }))
	assert.deepEqual([alone.content, alone.inputTokens, alone.outputTokens], ['**Error:** rate limited', 314, 20])

	// No errorMessage, or another stop reason: no error event, but usage all the same.
	const quiet = mapEntry(assistant('a4', [], { stopReason: 'error' }), newState())
	assert.deepEqual([quiet.events, quiet.errorMessage, quiet.usage?.usageReportKey], [[], undefined, 'a4'])
	const aborted = mapEntry(assistant('a5', [], { stopReason: 'aborted', errorMessage: 'x' }), newState())
	assert.deepEqual([aborted.events, aborted.errorMessage], [[], undefined])
})

test('an abort pi reports as an error sends no error event; a call with no tokens sends no usage', () => {
	const none: Usage = { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }
	const cases: [string, string[]][] = [
		['This operation was aborted', []],
		['Request was aborted.', []],
		['The operation was aborted due to timeout', ['**Error:** The operation was aborted due to timeout']],
		['404 model not found', ['**Error:** 404 model not found']],
	]
	for (const [errorMessage, contents] of cases) {
		const out = mapEntry(assistant('a9', [], { stopReason: 'error', errorMessage, usage: none }), newState())
		assert.deepEqual(
			out.events.map((e) => e.content),
			contents,
			errorMessage,
		)
		assert.deepEqual(
			[out.events[0]?.inputTokens, out.usage, out.errorMessage],
			[undefined, undefined, errorMessage],
		)
	}
})

test('tool calls are shaped for the UI in the cloud copy only', () => {
	const one = { oldText: 'a', newText: 'b' }
	const two = [one, { oldText: 'c', newText: 'd' }]
	const cases: [string, JsonObject, string, Record<string, unknown>][] = [
		['bash', { command: 'ls', timeout: 30 }, 'bash', { command: 'ls', timeout_ms: 30_000 }],
		['bash', { command: 'ls' }, 'bash', { command: 'ls' }],
		[
			'read',
			{ path: 'src/a.ts', offset: 2 },
			'read',
			{ path: 'src/a.ts', offset: 2, file_path: '/work/repo/src/a.ts' },
		],
		['read', { path: 'file://host/x' }, 'read', { path: 'file://host/x' }], // pi's own resolve throws here
		[
			'write',
			{ path: '/abs/b.ts', content: 'x' },
			'write',
			{ path: '/abs/b.ts', content: 'x', file_path: '/abs/b.ts' },
		],
		['edit', { path: 'c.ts', edits: [one] }, 'edit', { path: 'c.ts', edits: [one], file_path: '/work/repo/c.ts' }],
		[
			'edit',
			{ path: '@c.ts', edits: two },
			'MultiEdit',
			{ path: '@c.ts', edits: two, file_path: '/work/repo/c.ts' },
		],
		['find', { pattern: '*.ts', path: 'src' }, 'Glob', { pattern: '*.ts', path: 'src' }],
		['ls', {}, 'ls', { path: '.' }],
		['ls', { path: 'src', limit: 5 }, 'ls', { path: 'src', limit: 5 }],
		[
			'grep',
			{ pattern: 'x', path: 'src', ignoreCase: true },
			'grep',
			{ pattern: 'x', path: 'src', ignoreCase: true },
		],
		['my_tool', { nested: { list: [1, 'two', null] } }, 'my_tool', { nested: { list: [1, 'two', null] } }],
		[
			'get_artifact_comments',
			{ artifact_filename: 'research.md' },
			'mcp__humanlayer__get_artifact_comments',
			{ artifact_filename: 'research.md' },
		],
	]
	const entry = assistant(
		'a6',
		cases.map(([name, args], i) => toolCall(`c${i}`, name, args)),
	)
	const before = structuredClone(entry)
	const state = newState()
	const { events } = mapEntry(entry, state)
	assert.deepEqual(
		events.map((e) => [e.toolName, e.toolInputJson]),
		cases.map(([, , name, input]) => [name, input]),
	)
	assert.deepEqual(entry, before) // the entry is never changed
	assert.deepEqual(state.toolCalls.get('c0'), { name: 'bash', args: { command: 'ls', timeout: 30 } }) // raw args kept
})

test('bash results: exit code prefix on errors, and every bash result asks for a scan', () => {
	const cases: [string, boolean, string][] = [
		['ok', false, ''],
		['boom\n\nCommand exited with code 2', true, 'Exit code 2\n'],
		["say 'Command exited with code 7'\n\nCommand exited with code 3", true, 'Exit code 3\n'],
		['Command terminated without an exit code', true, 'Exit code 1\n'],
		['part\n\nCommand timed out after 5 seconds', true, 'Exit code 1\n'],
	]
	for (const [text, isError, prefix] of cases) {
		const out = mapEntry(toolResult('r1', 'b1', 'bash', text, isError), newState())
		assert.equal(out.events[0]?.toolResultContent, prefix + text)
		assert.deepEqual(out.touched, {})
	}
})

test('tool results: toolCalls flow from the assistant entry to shape write/edit results, then clear', () => {
	const state = newState()
	state.createdFiles.set('w1', '/work/repo/new.ts')
	mapEntry(
		assistant('a7', [
			toolCall('w1', 'write', { path: 'new.ts', content: 'x' }),
			toolCall('w2', 'write', { path: 'old.ts', content: 'y' }),
			toolCall('e1', 'edit', { path: '~/notes.md', edits: [] }),
			toolCall('r1', 'read', { path: 'pic.png' }),
		]),
		state,
	)
	assert.deepEqual([...state.toolCalls.keys()], ['w1', 'w2', 'e1', 'r1'])

	const created = mapEntry(toolResult('t1', 'w1', 'write', 'Wrote 1 byte'), state)
	assert.deepEqual(created.events, [
		{
			eventId: nameUuid('pi-session-1:t1:0'),
			codingAgentSessionId: 'pi-session-1',
			codingAgentEventId: 't1:0',
			eventType: 'tool_result',
			role: 'user',
			toolResultForId: 'w1',
			toolResultContent: 'File created successfully at: /work/repo/new.ts\nWrote 1 byte',
		},
	])
	assert.deepEqual(created.touched, { path: '/work/repo/new.ts' })

	const updated = mapEntry(toolResult('t2', 'w2', 'write', 'Wrote 1 byte'), state)
	assert.equal(updated.events[0]?.toolResultContent, 'Wrote 1 byte')
	assert.deepEqual(updated.touched, { path: '/work/repo/old.ts' })

	const edited = mapEntry(toolResult('t3', 'e1', 'edit', 'Edited'), state)
	assert.deepEqual(edited.touched, { path: join(homedir(), 'notes.md') })

	const image = { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }
	const readResult = { role: 'toolResult' as const, toolCallId: 'r1', toolName: 'read', isError: false, timestamp: 1 }
	const content = [{ type: 'text' as const, text: 'Read pic.png' }, image]
	const read = mapEntry(message('t4', { ...readResult, content }), state)
	assert.equal(read.events[0]?.toolResultContent, 'Read pic.png\n[image]')
	assert.equal(read.touched, undefined)

	assert.equal(state.toolCalls.size, 0) // each id is dropped once its result is mapped
})

test('failed writes get no prefix or path; a result whose call is unknown asks for a scan', () => {
	const state = newState()
	state.createdFiles.set('w1', '/work/repo/new.ts')
	const failed = mapEntry(toolResult('t1', 'w1', 'write', 'EACCES', true), state)
	assert.equal(failed.events[0]?.toolResultContent, 'EACCES')
	assert.equal(failed.touched, undefined)
	// A resume can land between a call and its result: the created path still works, else ask for a scan.
	const created = mapEntry(toolResult('t2', 'w1', 'write', 'Wrote'), state)
	assert.equal(created.events[0]?.toolResultContent, 'File created successfully at: /work/repo/new.ts\nWrote')
	assert.deepEqual(created.touched, { path: '/work/repo/new.ts' })
	assert.deepEqual(mapEntry(toolResult('t3', 'gone', 'edit', 'Edited'), state).touched, {})
})

test('bashExecution: a bash call and result pair, with an exit code prefix on failure or cancel', () => {
	const cases: [SessionEntry, string][] = [
		[bashRun('x1', 0), 'out'],
		[bashRun('x2', undefined), 'out'],
		[bashRun('x3', 3), 'Exit code 3\nout'],
		[bashRun('x4', undefined, true), 'Exit code 1\nout'],
		[bashRun('x5', 130, true), 'Exit code 1\nout'],
	]
	for (const [entry, result] of cases) {
		const out = mapEntry(entry, newState())
		const id = `pi-bash-${entry.id}`
		const call = { eventType: 'tool_call', role: 'assistant', toolCallId: id, toolName: 'bash' }
		const res = { eventType: 'tool_result', role: 'user', toolResultForId: id, toolResultContent: result }
		assert.deepEqual(
			out.events.map(({ eventId, codingAgentSessionId, ...rest }) => rest),
			[
				{ codingAgentEventId: `${entry.id}:0`, ...call, toolInputJson: { command: 'make test' } },
				{ codingAgentEventId: `${entry.id}:1`, ...res },
			],
		)
		assert.deepEqual(out.touched, {})
	}
})

test("compaction: the UI's two compaction events, linked by the first event's id", () => {
	const entry: SessionEntry = {
		type: 'compaction',
		...base('c1'),
		summary: 'We fixed the build.',
		firstKeptEntryId: 'u9',
		tokensBefore: 123_456,
	}
	const state = newState()
	state.compactionTrigger = 'manual'
	const { events } = mapEntry(entry, state)
	assert.deepEqual(
		events.map((e) => [e.codingAgentEventId, e.eventType, e.role]),
		[
			['c1:0', 'system', 'system'],
			['c1:1', 'system', 'system'],
		],
	)
	assert.deepEqual(parse(events[0]), { kind: 'context_compaction', trigger: 'manual', preTokens: 123_456 })
	assert.deepEqual(parse(events[1]), {
		kind: 'context_compaction_summary',
		boundaryEventId: events[0]?.eventId,
		summary: 'We fixed the build.',
	})
	// The default trigger is "auto".
	const auto = mapEntry(entry, newState()).events[0]
	assert.deepEqual(parse(auto), { kind: 'context_compaction', trigger: 'auto', preTokens: 123_456 })
})

test('every other entry type and message role becomes one hidden pi_<type> system event', () => {
	const cases: [string, SessionEntry][] = [
		['pi_model_change', { type: 'model_change', ...base('e1'), provider: 'anthropic', modelId: 'claude-test' }],
		['pi_thinking_level_change', { type: 'thinking_level_change', ...base('e2'), thinkingLevel: 'high' }],
		['pi_label', { type: 'label', ...base('e3'), targetId: 'u1', label: 'start' }],
		['pi_custom', { type: 'custom', ...base('e4'), customType: 'todo', data: { done: 1 } }],
		[
			'pi_custom_message',
			{ type: 'custom_message', ...base('e5'), customType: 'note', content: 'hi', display: true },
		],
		['pi_session_info', { type: 'session_info', ...base('e6'), name: 'My session' }],
		['pi_context_edit', { type: 'context_edit', ...base('e7'), targetId: 'u1', replacement: null }],
		['pi_branch_summary', { type: 'branch_summary', ...base('e8'), fromId: 'u1', summary: 'tried X' }],
		[
			'pi_custom',
			message('e9', { role: 'custom', customType: 'note', content: 'hi', display: false, timestamp: 1 }),
		],
		['pi_branchSummary', message('e10', { role: 'branchSummary', summary: 'tried X', fromId: null, timestamp: 1 })],
		[
			'pi_compactionSummary',
			message('e11', { role: 'compactionSummary', summary: 's', tokensBefore: 5, timestamp: 1 }),
		],
		['pi_future_entry', { type: 'future_entry', ...base('e12'), extra: true } as unknown as SessionEntry],
	]
	for (const [kind, entry] of cases) {
		const event = only(entry)
		assert.deepEqual([event.codingAgentEventId, event.eventType, event.role], [`${entry.id}:0`, 'system', 'system'])
		assert.deepEqual(parse(event), { kind, ...entry })
	}

	// The spread comes last (plan.md §5.2), so a usage entry keeps its own `kind`; `type` still says what it is.
	const usageEntry: SessionEntry = {
		type: 'usage',
		...base('e13'),
		kind: 'cache_warm',
		provider: 'anthropic',
		model: 'claude-test',
		usage,
	}
	assert.deepEqual(parse(only(usageEntry)), usageEntry)

	const big = only({ type: 'custom', ...base('e14'), customType: 'blob', data: 'x'.repeat(300 * 1024) })
	assert.match(big.content ?? '', TAIL)
	assert.equal(Buffer.byteLength((big.content ?? '').replace(TAIL, '')), 256 * 1024)
})

test('content, results and tool input strings over 1 MB are cut; tool call ids are cut to 256 chars', () => {
	const big = 'é'.repeat(MB) // 2 MB of UTF-8
	const cut = `${big.slice(0, MB / 2)}…[truncated ${MB} bytes]`
	const longId = 't'.repeat(300)
	const edits = [
		{ oldText: big, newText: 'b' },
		{ oldText: 'c', newText: 'd' },
	]
	const state = newState()
	const { events } = mapEntry(
		assistant('a8', [{ type: 'text', text: big }, toolCall(longId, 'edit', { path: 'f.ts', edits })]),
		state,
	)
	assert.equal(events[0]?.content, cut)
	assert.equal(events[1]?.toolCallId, longId.slice(0, 256))
	assert.deepEqual(events[1]?.toolInputJson, {
		path: 'f.ts',
		file_path: '/work/repo/f.ts',
		edits: [{ oldText: cut, newText: 'b' }, edits[1]],
	})
	assert.equal(edits[0]?.oldText, big) // the entry keeps the full text

	const result = only(toolResult('r8', longId, 'edit', big), state)
	assert.equal(result.toolResultForId, events[1]?.toolCallId)
	assert.equal(result.toolResultContent, cut)
	assert.equal(only(user('u8', 'a'.repeat(MB))).content?.length, MB) // exactly 1 MB is kept whole
})

test('systemEvent: a hidden system event whose id comes from idKey', () => {
	const payload = { kind: 'pi_fork', from: 'parent-1' }
	const event = systemEvent(newState(), 'fork:parent-1', payload)
	assert.deepEqual(event, {
		eventId: nameUuid('pi-session-1:fork:parent-1'),
		codingAgentSessionId: 'pi-session-1',
		codingAgentEventId: 'fork:parent-1',
		eventType: 'system',
		role: 'system',
		content: JSON.stringify(payload),
	})
	assert.match(event.eventId, UUID)
	assert.match(systemEvent(newState(), 'k', { blob: 'x'.repeat(MB) }).content ?? '', TAIL)
})

test('resolveToCwd resolves like pi: unicode spaces, one @, ~, file:// URLs, then cwd', () => {
	const cases: [string, string][] = [
		['src/a.ts', '/work/repo/src/a.ts'],
		['./src/../b.ts', '/work/repo/b.ts'],
		['../up.ts', '/work/up.ts'],
		['/etc/hosts', '/etc/hosts'],
		['@src/a.ts', '/work/repo/src/a.ts'],
		['@@x', '/work/repo/@x'],
		['~', homedir()],
		['~/notes.md', join(homedir(), 'notes.md')],
		['file:///tmp/a%20b.txt', '/tmp/a b.txt'],
		['my file.txt', '/work/repo/my file.txt'],
	]
	for (const [input, expected] of cases) assert.equal(resolveToCwd(input, CWD), expected, input)
	assert.equal(resolveToCwd('a.ts', '~/proj'), join(homedir(), 'proj', 'a.ts'))
})
