/**
 * Tests whether the Claude Agent SDK ever yields an `assistant` item with
 * ACCUMULATED content blocks (e.g. [thinking, text] together) rather than
 * one block per item. If it does, the daemon's handleMessage will try to
 * consume IDs that were already consumed by a prior incremental assistant
 * item, causing StreamEventIdLookupError.
 *
 * Uses ONLY the real SDK — no mocks.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, describe, test } from 'vitest'
import { z } from 'zod/v4'

delete process.env.CLAUDECODE
delete process.env.CLAUDE_CODE_ENTRYPOINT

const tempDirs: string[] = []

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const lookupTool = tool(
	'lookup_fact',
	'Returns a deterministic fact.',
	z.object({ subject: z.string() }).shape,
	async ({ subject }) => ({
		content: [{ type: 'text', text: `fact about ${subject}: 42` }],
	}),
)

const countTool = tool('count_items', 'Returns a count.', z.object({ label: z.string() }).shape, async ({ label }) => ({
	content: [{ type: 'text', text: `count for ${label}: 7` }],
}))

type AssistantSnapshot = {
	pos: number
	blockTypes: string[]
	contentIsString: boolean
}

async function collectAssistantSnapshots(
	sdkIterator: ReturnType<typeof query>,
	label: string,
): Promise<AssistantSnapshot[]> {
	const snapshots: AssistantSnapshot[] = []
	let pos = 0

	for await (const item of sdkIterator) {
		if (item.type === 'stream_event') {
			const event = (item as any).event
			const extra =
				event.type === 'content_block_start'
					? ` (${event.content_block?.type}, index=${event.index})`
					: event.type === 'content_block_stop'
						? ` (index=${event.index})`
						: ''
			if (
				event.type === 'content_block_start' ||
				event.type === 'content_block_stop' ||
				event.type === 'message_start' ||
				event.type === 'message_stop' ||
				event.type === 'message_delta'
			) {
				console.log(`  [${label}][${pos}] stream_event: ${event.type}${extra}`)
			}
		} else if (item.type === 'assistant') {
			const content = (item as any).message.content
			const contentIsString = typeof content === 'string'
			const blockTypes = contentIsString
				? ['string']
				: Array.isArray(content)
					? content.map((b: any) => b.type)
					: ['unknown']
			const snapshot: AssistantSnapshot = { pos, blockTypes, contentIsString }
			snapshots.push(snapshot)

			const marker = blockTypes.length > 1 ? ' ⚠️ MULTI-BLOCK' : ''
			console.log(`  [${label}][${pos}] assistant: content=[${blockTypes.join(', ')}]${marker}`)
		} else if (item.type === 'user') {
			const content = (item as any).message?.content
			const blockTypes = Array.isArray(content)
				? content.map((b: any) => (typeof b === 'string' ? 'string' : b.type)).join(', ')
				: 'string'
			console.log(`  [${label}][${pos}] user: content=[${blockTypes}]`)
		} else {
			const sub = (item as any).subtype ? ` (${(item as any).subtype})` : ''
			console.log(`  [${label}][${pos}] ${item.type}${sub}`)
		}
		pos++
	}

	return snapshots
}

function reportFindings(label: string, snapshots: AssistantSnapshot[]) {
	const multiBlockSnapshots = snapshots.filter((s) => s.blockTypes.length > 1)
	const stringContentSnapshots = snapshots.filter((s) => s.contentIsString)

	console.log(`\n[${label}] Summary:`)
	console.log(`  Total assistant items: ${snapshots.length}`)
	console.log(`  Multi-block assistant items: ${multiBlockSnapshots.length}`)
	console.log(`  String-content assistant items: ${stringContentSnapshots.length}`)

	if (multiBlockSnapshots.length > 0) {
		console.log(`  ⚠️ FOUND ACCUMULATED BLOCKS:`)
		for (const s of multiBlockSnapshots) {
			console.log(`    pos=${s.pos} blocks=[${s.blockTypes.join(', ')}]`)
		}
	}

	return { multiBlockSnapshots, stringContentSnapshots }
}

describe.skipIf(!!process.env.CI)('SDK assistant item accumulation patterns', () => {
	test('thinking+text: check if any assistant has multiple blocks', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-thinking-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think carefully about what 2+2 equals. Then reply with exactly: accumulation check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'think+text')
		const { multiBlockSnapshots } = reportFindings('think+text', snapshots)

		// Record whether we found accumulated blocks — this is informational,
		// not a hard assertion. We WANT to find them to prove the bug theory.
		if (multiBlockSnapshots.length > 0) {
			console.log('🔴 ACCUMULATED BLOCKS FOUND — this would trigger StreamEventIdLookupError')
		} else {
			console.log('🟢 No accumulated blocks — SDK yielded one block per assistant item')
		}
	})

	test('thinking+text with opus model: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-opus-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think step by step about what makes a good API. Then reply with exactly: opus accumulation check',
			options: {
				model: 'claude-opus-4-7',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 10000, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'opus-think')
		reportFindings('opus-think', snapshots)
	})

	test('thinking+tool_use+thinking+text multi-turn: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-tool-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think step by step, use lookup_fact with subject "accumulation", think about the result, then reply with exactly: tool accumulation check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 3,
				allowedTools: ['mcp__testserver__lookup_fact'],
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool] }),
				},
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'tool-multi')
		reportFindings('tool-multi', snapshots)
	})

	test('thinking+text+tool_use in single turn (text before tool): check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-text-before-tool-'))
		tempDirs.push(cwd)

		// Try to get Claude to emit text THEN tool_use in the same message
		const iter = query({
			prompt: 'Think about the task, then say "Let me look that up for you" as visible text, then use lookup_fact with subject "inline-text". After the tool result, reply with exactly: text-before-tool check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 3,
				allowedTools: ['mcp__testserver__lookup_fact'],
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool] }),
				},
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'text-before-tool')
		reportFindings('text-before-tool', snapshots)
	})

	test('parallel tool calls: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-parallel-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think first, then call lookup_fact with subject "parallel-a" and count_items with label "parallel-b" in parallel in the same response. After both results, reply with exactly: parallel accumulation check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 3,
				allowedTools: ['mcp__testserver__lookup_fact', 'mcp__testserver__count_items'],
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool, countTool] }),
				},
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'parallel')
		reportFindings('parallel', snapshots)
	})

	test('sub-agent dispatch: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-subagent-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think about the task. Then dispatch a sub-agent to write "hello" to a file called /tmp/accum-test.txt. After the sub-agent returns, reply with exactly: subagent accumulation check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 5,
				tools: ['Agent', 'Write'],
				allowedTools: ['Agent', 'Write'],
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'subagent')
		reportFindings('subagent', snapshots)
	})

	test('thinking with display:omitted: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-omitted-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think carefully about what 3+3 equals. Then reply with exactly: omitted accumulation check',
			options: {
				model: 'claude-sonnet-4-5',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
				// The daemon uses display:'summarized' but let's test omitted too
				thinking: { type: 'enabled', budgetTokens: 8192, display: 'omitted' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'omitted')
		reportFindings('omitted', snapshots)
	})

	test('string content response (no thinking): check if content is string vs array', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-string-'))
		tempDirs.push(cwd)

		// Without thinking enabled, the SDK might yield content as a string
		const iter = query({
			prompt: 'Reply with exactly this text and nothing else: string content check',
			options: {
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
				// No thinking config — might get string content
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'no-thinking')
		const { stringContentSnapshots } = reportFindings('no-thinking', snapshots)

		if (stringContentSnapshots.length > 0) {
			console.log('📝 String content detected — handleMessage uses blockIndex=0 for string path')
		}
	})

	test('opus 1M context: check accumulation', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'accum-opus-1m-'))
		tempDirs.push(cwd)

		const iter = query({
			prompt: 'Think step by step about prime numbers. Then reply with exactly: opus 1m accumulation check',
			options: {
				model: 'claude-opus-4-7[1m]',
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
				thinking: { type: 'enabled', budgetTokens: 31999, display: 'summarized' },
			},
		})

		const snapshots = await collectAssistantSnapshots(iter, 'claude-opus-4-7[1m]')
		reportFindings('claude-opus-4-7[1m]', snapshots)
	})
})
