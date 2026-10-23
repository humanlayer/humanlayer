// The mapper on its own: a rollout Codex 0.155.1 wrote (test/fixtures, trimmed of its system
// prompt), and records built to the same shapes.

import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { createMapperState, type Mapped, mapRecord, mapToolCall, mapToolResult, shapeHookTool } from '../src/mapper.ts'
import { type RolloutRecord, RolloutTail } from '../src/rollout.ts'
import { rec } from './helpers/codex.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/rollout-0.155.1.jsonl', import.meta.url))

function record(r: { type: string; payload: Record<string, unknown> }, offset = 0): RolloutRecord {
	return { offset, end: offset + 1, type: r.type, payload: r.payload }
}

function all(records: RolloutRecord[], state = createMapperState('thread', '/repo')): Mapped[] {
	return records.map((r) => mapRecord(r, state))
}

test('a recorded Codex rollout maps to the prompts, replies, tools and status the web app shows', async () => {
	const records = await new RolloutTail(FIXTURE, 0).read()
	const state = createMapperState('thread', '/private/tmp/cx-spike/repo')
	const mapped = all(records, state)
	const events = mapped.flatMap((m) => m.events)
	const kinds = events.map((e) => (e.eventType === 'tool_call' ? `call:${e.toolName}` : `${e.eventType}:${e.role}`))
	assert.deepEqual(kinds, [
		'message:user',
		'message:assistant',
		'call:Bash',
		'tool_result:user',
		'call:apply_patch',
		'tool_result:user',
		'message:assistant',
		'message:user',
		'message:assistant',
	])
	const bash = events.find((e) => e.toolName === 'Bash')
	assert.deepEqual(bash?.toolInputJson, { command: 'ls' })
	const patch = events.find((e) => e.toolName === 'apply_patch')
	assert.equal(
		(patch?.toolInputJson as { patch_text: string }).patch_text,
		'*** Begin Patch\n*** Add File: /private/tmp/cx-spike/repo/b.txt\n+bee\n*** End Patch',
	)
	assert.deepEqual(
		mapped.flatMap((m) => (m.status ? [m.status] : [])),
		['running', 'ready_for_input', 'running', 'ready_for_input'],
	)
	assert.equal(mapped.filter((m) => m.usage).length, 4)
	assert.deepEqual(mapped.find((m) => m.touched)?.touched, ['/private/tmp/cx-spike/repo/b.txt'])
	assert.equal(state.model, 'gpt-6-luna')
	assert.equal(state.openTools.size, 0)
})

test('the same records give the same event ids, and a second read adds nothing', async () => {
	const records = await new RolloutTail(FIXTURE, 0).read()
	const ids = (m: Mapped[]) => m.flatMap((x) => x.events.map((e) => e.eventId))
	const state = createMapperState('thread', '/repo')
	const first = ids(all(records, state))
	assert.deepEqual(ids(all(records)), first)
	assert.deepEqual(ids(all(records, state)), [])
})

test('the rollout reader keeps a partial last line for the next read', async () => {
	const { mkdtempSync, writeFileSync, appendFileSync } = await import('node:fs')
	const { join } = await import('node:path')
	const { tmpdir } = await import('node:os')
	const path = join(mkdtempSync(join(tmpdir(), 'cx-tail-')), 'r.jsonl')
	writeFileSync(path, '{"type":"a","payload":{}}\n{"type":"b"')
	const tail = new RolloutTail(path, 0)
	assert.deepEqual(
		(await tail.read()).map((r) => r.type),
		['a'],
	)
	appendFileSync(path, ',"payload":{}}\n')
	const [b] = await tail.read()
	assert.equal(b?.type, 'b')
	assert.equal(b?.offset, 26)
})

test('a tool call from PreToolUse goes up once, and its rollout item adds only the result', () => {
	const state = createMapperState('thread', '/repo')
	const call = mapToolCall({ tool_name: 'Bash', tool_use_id: 'exec-1', tool_input: { command: 'ls' } }, state)
	assert.equal(call.events.length, 1)
	const item = mapRecord(record(rec.command('exec-1', 'ls', 'a\n')), state)
	assert.deepEqual(
		item.events.map((e) => e.eventType),
		['tool_result'],
	)
	assert.equal(state.openTools.size, 0)
})

test('a tool with no PreToolUse, such as your own ! command, still gets its call before its result', () => {
	const mapped = mapRecord(record(rec.command('exec-2', 'git status', 'clean', 0)), createMapperState('t', '/repo'))
	assert.deepEqual(
		mapped.events.map((e) => e.eventType),
		['tool_call', 'tool_result'],
	)
	assert.equal(mapped.scan, true)
})

test('tool names and inputs match the web app views', () => {
	assert.deepEqual(shapeHookTool('Bash', { command: 'ls' }, '/r'), ['Bash', { command: 'ls' }])
	assert.deepEqual(shapeHookTool('apply_patch', { command: '*** Begin Patch' }, '/r'), [
		'apply_patch',
		{ patch_text: '*** Begin Patch' },
	])
	assert.deepEqual(
		shapeHookTool(
			'update_plan',
			{
				plan: [
					{ step: 'read', status: 'completed' },
					{ step: 'write', status: 'in_progress' },
				],
			},
			'/r',
		),
		[
			'TodoWrite',
			{
				todos: [
					{ content: 'read', status: 'completed', activeForm: 'read' },
					{ content: 'write', status: 'in_progress', activeForm: 'write' },
				],
			},
		],
	)
	assert.deepEqual(shapeHookTool('view_image', { path: 'a.png' }, '/r'), ['Read', { file_path: '/r/a.png' }])
	assert.deepEqual(shapeHookTool('collaborationspawn_agent', { message: 'count them', agent_type: 'worker' }, '/r'), [
		'Task',
		{ subagent_type: 'worker', description: 'count them', prompt: 'count them' },
	])
	assert.deepEqual(shapeHookTool('mcp__humanlayer__get_diff_comments', { limit: 5 }, '/r'), [
		'mcp__humanlayer__get_diff_comments',
		{ limit: 5 },
	])
	const mcp = mapRecord(
		record(
			rec.item({
				type: 'McpToolCall',
				id: 'call_9',
				server: 'humanlayer',
				tool: 'get_artifact_comments',
				arguments: { artifact_filename: 'research.md' },
				status: 'completed',
				result: { content: [{ type: 'text', text: '<comments/>' }], isError: false },
			}),
		),
		createMapperState('t', '/r'),
	)
	assert.equal(mcp.events[0]?.toolName, 'mcp__humanlayer__get_artifact_comments')
	assert.equal(mcp.events[1]?.toolResultContent, '<comments/>')
})

test('update_plan takes its result from PostToolUse; shell commands wait for their rollout item', () => {
	const state = createMapperState('t', '/r')
	mapToolCall({ tool_name: 'update_plan', tool_use_id: 'p1', tool_input: { plan: [] } }, state)
	assert.equal(
		mapToolResult({ tool_name: 'update_plan', tool_use_id: 'p1', tool_response: 'Plan updated' }, state).events
			.length,
		1,
	)
	mapToolCall({ tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'ls' } }, state)
	assert.equal(mapToolResult({ tool_name: 'Bash', tool_use_id: 'b1', tool_response: 'a' }, state).events.length, 0)
})

test('a step with all-zero usage reports nothing; usage leaves the cached part out of input', () => {
	const state = createMapperState('t', '/r')
	state.model = 'gpt-6-sol'
	assert.equal(mapRecord(record(rec.tokens(0, 0, 0)), state).usage, undefined)
	const usage = mapRecord(record(rec.tokens(1000, 800, 20), 9), state).usage
	assert.deepEqual(usage?.modelUsage, {
		'gpt-6-sol': {
			input_tokens: 200,
			output_tokens: 20,
			cache_read_input_tokens: 800,
			cache_creation_input_tokens: 0,
		},
	})
	assert.equal(usage?.contextWindowTokens, 1020)
})

test('a compaction is a boundary and a summary that points to it; an error fails the turn', () => {
	const state = createMapperState('t', '/r')
	state.compactTrigger = 'manual'
	const boundary = mapRecord(record(rec.compaction('c1')), state).events[0]
	assert.deepEqual(JSON.parse(String(boundary?.content)), { kind: 'context_compaction', trigger: 'manual' })
	const summary = mapRecord(record(rec.compacted('the summary'), 5), state).events[0]
	assert.deepEqual(JSON.parse(String(summary?.content)), {
		kind: 'context_compaction_summary',
		boundaryEventId: boundary?.eventId,
		summary: 'the summary',
	})
	const failed = mapRecord(record(rec.error('rate limited'), 6), state)
	assert.equal(failed.status, 'failed')
	assert.equal(failed.events[0]?.content, '**Error:** rate limited')
	assert.equal(mapRecord(record(rec.aborted('t1'), 7), state).status, 'interrupted')
})

test('prompts the cloud wrote are skipped once each; items with no view go up hidden', () => {
	const state = createMapperState('t', '/r')
	state.skipPrompts.push('from the web')
	const skipped = mapRecord(record(rec.user('from the web')), state)
	assert.equal(skipped.events.length, 0)
	assert.equal(skipped.skipped, 'from the web')
	assert.equal(mapRecord(record(rec.user('from the web'), 1), state).events.length, 1)
	const hidden = mapRecord(record(rec.item({ type: 'EnteredReviewMode', id: 'r1', target: 'x' }), 2), state).events[0]
	assert.equal(hidden?.eventType, 'system')
	assert.equal(JSON.parse(String(hidden?.content)).kind, 'codex_item')
})
