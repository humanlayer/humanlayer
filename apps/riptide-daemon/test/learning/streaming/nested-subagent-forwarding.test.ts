import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, describe, expect, test } from 'vitest'

delete process.env.CLAUDECODE
delete process.env.CLAUDE_CODE_ENTRYPOINT

const tempDirs: string[] = []

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

/** One content block of an assistant/user message, reduced to what the daemon persists. */
interface ObservedBlock {
	type: string
	toolName?: string
	toolUseId?: string
	text?: string
}

interface ObservedMessage {
	type: 'assistant' | 'user'
	parentToolUseId: string | null
	contentIsString: boolean
	blocks: ObservedBlock[]
}

interface ObservedTaskStarted {
	toolUseId: string | undefined
	spawnDepth: number | undefined
}

interface NestedRun {
	messages: ObservedMessage[]
	taskStarted: ObservedTaskStarted[]
	/** Agent tool_use made by the main loop. */
	depth1AgentId: string
	/** Agent tool_use made inside the depth-1 subagent. */
	depth2AgentId: string
	markerContents: string
}

function observeBlocks(content: unknown): ObservedBlock[] {
	if (typeof content === 'string') return [{ type: 'string', text: content.slice(0, 80) }]
	if (!Array.isArray(content)) return []
	return content.map((block) => {
		const b = block as { type: string; name?: string; id?: string; tool_use_id?: string; text?: string }
		return {
			type: b.type,
			toolName: b.name,
			toolUseId: b.type === 'tool_use' ? b.id : b.tool_use_id,
			text: typeof b.text === 'string' ? b.text.slice(0, 80) : undefined,
		}
	})
}

function childrenOf(run: NestedRun, parentToolUseId: string): ObservedMessage[] {
	return run.messages.filter((m) => m.parentToolUseId === parentToolUseId)
}

function blocksOf(messages: ObservedMessage[], type: ObservedMessage['type']): ObservedBlock[] {
	return messages.filter((m) => m.type === type).flatMap((m) => m.blocks)
}

/** Prints the parent tree so the learning result is readable in the test output. */
function logTrace(label: string, run: NestedRun): void {
	const lines = run.messages.map((m) => {
		const parent =
			m.parentToolUseId === null
				? 'main  '
				: m.parentToolUseId === run.depth1AgentId
					? 'depth1'
					: m.parentToolUseId === run.depth2AgentId
						? 'depth2'
						: `other(${m.parentToolUseId})`
		const blocks = m.blocks.map((b) => (b.toolName ? `${b.type}:${b.toolName}` : b.type)).join(',')
		return `  ${parent} ${m.type.padEnd(9)} ${m.contentIsString ? '[string] ' : ''}${blocks}`
	})
	console.log(
		[
			`--- ${label} ---`,
			`depth1 Agent ${run.depth1AgentId}`,
			`depth2 Agent ${run.depth2AgentId}`,
			`task_started ${JSON.stringify(run.taskStarted)}`,
			...lines,
		].join('\n'),
	)
}

async function runNestedAgents(forwardSubagentText: boolean): Promise<NestedRun> {
	const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-nested-subagents-'))
	tempDirs.push(cwd)
	const markerPath = join(cwd, 'depth-2-marker.txt')

	const innerPrompt = `Use the Write tool to write exactly "depth-2-ran" to ${markerPath}. Then reply with exactly: DEPTH2_DONE`
	const middlePrompt = `Use the Agent tool to spawn one subagent with this exact prompt: '${innerPrompt}'. Do not write the file yourself. After the subagent returns, reply with exactly: DEPTH1_DONE`

	const queryResult = query({
		prompt: `Use the Agent tool to spawn one subagent with this exact prompt: "${middlePrompt}". Do not use any other tool yourself. After the subagent returns, reply with exactly: MAIN_DONE`,
		options: {
			model: 'claude-sonnet-4-5',
			cwd,
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			maxTurns: 6,
			tools: ['Agent', 'Write'],
			allowedTools: ['Agent', 'Write'],
			includePartialMessages: true,
			forwardSubagentText,
			env: {
				...process.env,
				// Match the daemon: foreground subagents only.
				CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
			},
		},
	})

	const messages: ObservedMessage[] = []
	const taskStarted: ObservedTaskStarted[] = []
	for await (const item of queryResult as AsyncIterable<SDKMessage>) {
		if (item.type === 'assistant' || item.type === 'user') {
			messages.push({
				type: item.type,
				parentToolUseId: item.parent_tool_use_id,
				contentIsString: typeof item.message.content === 'string',
				blocks: observeBlocks(item.message.content),
			})
		}
		if (item.type === 'system' && item.subtype === 'task_started') {
			taskStarted.push({ toolUseId: item.tool_use_id, spawnDepth: item.spawn_depth })
		}
	}

	const agentCalls = messages.flatMap((m) =>
		m.blocks
			.filter((b) => b.type === 'tool_use' && b.toolName === 'Agent' && b.toolUseId)
			.map((b) => ({ id: b.toolUseId!, parent: m.parentToolUseId })),
	)
	const depth1 = agentCalls.find((c) => c.parent === null)
	if (!depth1) throw new Error('main loop never called Agent')
	const depth2 = agentCalls.find((c) => c.parent === depth1.id)

	const run: NestedRun = {
		messages,
		taskStarted,
		depth1AgentId: depth1.id,
		depth2AgentId: depth2?.id ?? '(none)',
		markerContents: await readFile(markerPath, 'utf8').catch(() => ''),
	}
	logTrace(`forwardSubagentText: ${forwardSubagentText}`, run)
	if (!depth2) throw new Error('depth-1 subagent never called Agent, or its tool_use was not forwarded')
	return run
}

describe.skipIf(!!process.env.CI)('Claude Agent SDK nested subagent forwarding', () => {
	test('without forwardSubagentText, only the depth-1 prompt and tool blocks reach the stream; depth 2 is silent', async () => {
		const run = await runNestedAgents(false)

		// Depth 2 really ran: the file exists, yet nothing it did reached the stream.
		expect(run.markerContents).toBe('depth-2-ran')
		expect(childrenOf(run, run.depth2AgentId)).toEqual([])

		const depth1 = childrenOf(run, run.depth1AgentId)
		// The prompt arrives as a user message with array content.
		expect(blocksOf(depth1, 'user').some((b) => b.type === 'text')).toBe(true)
		// The depth-1 subagent's own Agent call and its result are forwarded as tool blocks.
		expect(blocksOf(depth1, 'assistant')).toContainEqual(
			expect.objectContaining({ type: 'tool_use', toolName: 'Agent', toolUseId: run.depth2AgentId }),
		)
		expect(blocksOf(depth1, 'user')).toContainEqual(
			expect.objectContaining({ type: 'tool_result', toolUseId: run.depth2AgentId }),
		)
		// Its text and thinking are dropped: every forwarded assistant block is a tool_use.
		expect(blocksOf(depth1, 'assistant').every((b) => b.type === 'tool_use')).toBe(true)
	})

	test('with forwardSubagentText, depth-2 messages arrive keyed by the nested Agent tool_use id', async () => {
		const run = await runNestedAgents(true)

		expect(run.markerContents).toBe('depth-2-ran')

		const depth2 = childrenOf(run, run.depth2AgentId)
		// The nested subagent's prompt, its Write call and result, and its final text.
		expect(blocksOf(depth2, 'user').some((b) => b.type === 'text')).toBe(true)
		expect(blocksOf(depth2, 'assistant')).toContainEqual(
			expect.objectContaining({ type: 'tool_use', toolName: 'Write' }),
		)
		expect(blocksOf(depth2, 'user').some((b) => b.type === 'tool_result')).toBe(true)
		expect(blocksOf(depth2, 'assistant').some((b) => b.type === 'text')).toBe(true)

		// Depth-1 text is forwarded too.
		const depth1 = childrenOf(run, run.depth1AgentId)
		expect(blocksOf(depth1, 'assistant').some((b) => b.type === 'text')).toBe(true)

		// process-events.ts drops user messages with string content; forwarded subagent messages must not use it.
		const forwarded = run.messages.filter((m) => m.parentToolUseId !== null)
		expect(forwarded.filter((m) => m.contentIsString)).toEqual([])
	})
})
