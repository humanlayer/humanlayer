import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { afterAll, describe, expect, test } from 'vitest'
import { z } from 'zod/v4'

import { createPartialTextStreamFixture, createThinkingStreamFixture } from './stream-fixtures'

delete process.env.CLAUDECODE
delete process.env.CLAUDE_CODE_ENTRYPOINT

const tempDirs: string[] = []

const lookupTool = tool(
	'lookup_stream_fact',
	'Returns a deterministic fact about Claude Agent SDK stream event testing.',
	z.object({ subject: z.string() }).shape,
	async ({ subject }) => ({
		content: [
			{ type: 'text', text: `lookup result for ${subject}: deltas are streamed before final assistant messages` },
		],
	}),
)

const countTool = tool(
	'count_stream_events',
	'Returns a deterministic count for stream event planning.',
	z.object({ label: z.string() }).shape,
	async ({ label }) => ({ content: [{ type: 'text', text: `count result for ${label}: 7` }] }),
)

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe.skipIf(!!process.env.CI)('Claude Agent SDK partial delta streaming', () => {
	test('streams ordered text delta events when includePartialMessages is enabled', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-partial-deltas-'))
		tempDirs.push(cwd)
		const fixture = createPartialTextStreamFixture()

		const queryResult = query({
			prompt: 'Reply with exactly this text and nothing else: streaming delta check',
			options: {
				cwd,
				permissionMode: 'bypassPermissions',
				maxTurns: 1,
				allowedTools: [],
				includePartialMessages: true,
			},
		})

		for await (const item of queryResult) {
			fixture.observe(item)
		}

		fixture.expectComplete()
	})

	describe('thinking blocks', () => {
		test('emits a completed thinking block before the assistant text block', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-thinking-blocks-'))
			tempDirs.push(cwd)
			const fixture = createThinkingStreamFixture()

			const queryResult = query({
				prompt: 'Think hard before answering. Solve this privately before answering: Design an invariant checker for a streaming protocol with nested message, content-block, and delta lifecycles. Consider at least three failure modes, explain to yourself how to detect them, and then reply with exactly this text and nothing else: thinking delta check',
				options: {
					model: 'claude-sonnet-4-5',
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 1,
					allowedTools: [],
					includePartialMessages: true,
					thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
					effort: 'max',
					env: {
						...process.env,
						CLAUDE_CODE_EFFORT_LEVEL: 'high',
					},
				},
			})

			for await (const item of queryResult) {
				fixture.observe(item)
			}

			fixture.expectComplete()
		})
	})

	describe('tool call streaming', () => {
		test('streams one tool call, tool result, and final response', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-tool-call-'))
			tempDirs.push(cwd)
			let sawToolUse = false
			let sawToolResult = false
			let sawFinalText = false
			let toolUseId: string | undefined

			const queryResult = query({
				prompt: 'Use lookup_stream_fact exactly once with subject "single-tool", then reply with exactly this text and nothing else: single tool complete',
				options: {
					tools: [],
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 3,
					allowedTools: ['mcp__testserver__lookup_stream_fact'],
					mcpServers: {
						testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool] }),
					},
					includePartialMessages: true,
				},
			})

			for await (const item of queryResult) {
				if (item.type !== 'stream_event') {
					console.log(JSON.stringify(item, null, 2))
				}

				if (item.type === 'stream_event') {
					console.log(item)
					if (item.event.type === 'content_block_start' && item.event.content_block.type === 'tool_use') {
						console.log(JSON.stringify(item.event.content_block, null, 2))
					}
				}

				if (item.type === 'assistant') {
					for (const contentBlock of item.message.content) {
						if (contentBlock.type === 'tool_use') {
							expect(sawToolUse).toBe(false)
							expect(sawToolResult).toBe(false)
							expect(sawFinalText).toBe(false)
							expect(contentBlock.name).toBe('mcp__testserver__lookup_stream_fact')
							expect(contentBlock.id.length).toBeGreaterThan(0)
							toolUseId = contentBlock.id
							sawToolUse = true
						}

						if (contentBlock.type === 'text' && sawToolResult) {
							expect(sawToolUse).toBe(true)
							expect(contentBlock.text.length).toBeGreaterThan(0)
							sawFinalText = true
						}
					}
				}

				if (item.type === 'user') {
					for (const contentBlock of item.message.content) {
						if (typeof contentBlock !== 'string' && contentBlock.type === 'tool_result') {
							expect(sawToolUse).toBe(true)
							expect(sawToolResult).toBe(false)
							if (!toolUseId) throw new Error('expected tool use id before tool result')
							expect(contentBlock.tool_use_id).toBe(toolUseId)
							sawToolResult = true
						}
					}
				}
			}

			expect(sawToolUse).toBe(true)
			expect(sawToolResult).toBe(true)
			expect(sawFinalText).toBe(true)
		})

		test('streams thinking, one tool call, tool result, and final response', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-thinking-tool-call-'))
			tempDirs.push(cwd)
			let sawThinking = false
			let sawToolUse = false
			let sawToolResult = false
			let sawFinalText = false
			let sawThinkingAfterToolUse = false
			let sawThinkingAfterToolResult = false
			let sawCompletedAssistantThinkingBeforeToolStart = false
			let sawStreamThinkingStart = false
			let sawStreamToolStartAfterCompletedThinking = false
			let toolUseId: string | undefined

			const queryResult = query({
				prompt: 'Think hard before using tools. Use lookup_stream_fact exactly once with subject "thinking-tool", then reply with exactly this text and nothing else: thinking tool complete',
				options: {
					model: 'claude-sonnet-4-5',
					tools: [],
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 3,
					allowedTools: ['mcp__testserver__lookup_stream_fact'],
					mcpServers: {
						testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool] }),
					},
					includePartialMessages: true,
					thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
					effort: 'max',
					env: {
						...process.env,
						CLAUDE_CODE_EFFORT_LEVEL: 'high',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'stream_event') {
					console.log(item)

					if (item.event.type === 'content_block_start' && item.event.content_block.type === 'thinking') {
						expect(item.event.index).toBe(0)
						sawStreamThinkingStart = true
					}

					if (item.event.type === 'content_block_start' && item.event.content_block.type === 'tool_use') {
						expect(sawStreamThinkingStart).toBe(true)
						expect(sawCompletedAssistantThinkingBeforeToolStart).toBe(true)
						expect(item.event.index).toBe(1)
						sawStreamToolStartAfterCompletedThinking = true
					}
				}

				if (item.type === 'assistant') {
					console.log(JSON.stringify(item.message.content, null, 2))
					for (const contentBlock of item.message.content) {
						if (contentBlock.type === 'thinking') {
							expect(contentBlock.thinking.length).toBeGreaterThan(0)
							if (sawToolUse) {
								sawThinkingAfterToolUse = true
							}
							if (sawToolResult) {
								sawThinkingAfterToolResult = true
							}
							if (sawStreamThinkingStart && !sawToolUse) {
								sawCompletedAssistantThinkingBeforeToolStart = true
							}
							sawThinking = true
						}

						if (contentBlock.type === 'tool_use') {
							expect(sawThinking).toBe(true)
							expect(sawToolResult).toBe(false)
							expect(contentBlock.name).toBe('mcp__testserver__lookup_stream_fact')
							toolUseId = contentBlock.id
							sawToolUse = true
						}

						if (contentBlock.type === 'text' && sawToolResult) {
							expect(contentBlock.text.length).toBeGreaterThan(0)
							sawFinalText = true
						}
					}
				}

				if (item.type === 'user') {
					for (const contentBlock of item.message.content) {
						if (typeof contentBlock !== 'string' && contentBlock.type === 'tool_result') {
							expect(sawToolUse).toBe(true)
							if (!toolUseId) throw new Error('expected tool use id before tool result')
							expect(contentBlock.tool_use_id).toBe(toolUseId)
							sawToolResult = true
						}
					}
				}
			}

			expect(sawThinking).toBe(true)
			expect(sawToolUse).toBe(true)
			expect(sawToolResult).toBe(true)
			expect(sawFinalText).toBe(true)
			expect(sawCompletedAssistantThinkingBeforeToolStart).toBe(true)
			expect(sawStreamToolStartAfterCompletedThinking).toBe(true)
			if (sawThinkingAfterToolUse) {
				expect(sawThinking).toBe(true)
			}
			if (sawThinkingAfterToolResult) {
				expect(sawToolResult).toBe(true)
			}
		})

		test('streams thinking, multiple tools, and final response', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-multi-thinking-tool-call-'))
			tempDirs.push(cwd)
			let thinkingBlocks = 0
			let toolUses = 0
			let toolResults = 0
			let sawFinalText = false
			const toolUseIds: string[] = []

			const queryResult = query({
				prompt: 'Think hard before each tool use. First use lookup_stream_fact with subject "multi-tool". Then think again and use count_stream_events with label "multi-tool". Then reply with exactly this text and nothing else: multi tool complete',
				options: {
					model: 'claude-sonnet-4-5',
					tools: [],
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 5,
					allowedTools: ['mcp__testserver__lookup_stream_fact', 'mcp__testserver__count_stream_events'],
					mcpServers: {
						testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool, countTool] }),
					},
					includePartialMessages: true,
					thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
					effort: 'max',
					env: {
						...process.env,
						CLAUDE_CODE_EFFORT_LEVEL: 'high',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'stream_event') {
					console.log(item)
				}

				if (item.type === 'assistant') {
					for (const contentBlock of item.message.content) {
						if (contentBlock.type === 'thinking') {
							expect(sawFinalText).toBe(false)
							expect(contentBlock.thinking.length).toBeGreaterThan(0)
							thinkingBlocks += 1
						}

						if (contentBlock.type === 'tool_use') {
							expect(sawFinalText).toBe(false)
							expect(contentBlock.id.length).toBeGreaterThan(0)
							expect([
								'mcp__testserver__lookup_stream_fact',
								'mcp__testserver__count_stream_events',
							]).toContain(contentBlock.name)
							toolUseIds.push(contentBlock.id)
							toolUses += 1
						}

						if (contentBlock.type === 'text' && toolResults >= 2) {
							expect(contentBlock.text.length).toBeGreaterThan(0)
							sawFinalText = true
						}
					}
				}

				if (item.type === 'user') {
					for (const contentBlock of item.message.content) {
						if (typeof contentBlock !== 'string' && contentBlock.type === 'tool_result') {
							expect(toolUseIds).toContain(contentBlock.tool_use_id)
							toolResults += 1
						}
					}
				}
			}

			expect(thinkingBlocks).toBeGreaterThanOrEqual(1)
			expect(toolUses).toBeGreaterThanOrEqual(2)
			expect(toolResults).toBeGreaterThanOrEqual(2)
			expect(sawFinalText).toBe(true)
		})

		test('streams parallel tool calls in one assistant message', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-parallel-tool-call-'))
			tempDirs.push(cwd)
			const streamedToolStarts: Array<{ index: number; name: string; id: string }> = []
			const streamedToolInputChunks = new Map<number, string[]>()
			const completedToolUses: Array<{ id: string; name: string; input: unknown }> = []
			const toolResults: string[] = []
			let sawFinalText = false
			let activeToolUseMessageDepth = 0

			const queryResult = query({
				prompt: 'Call lookup_stream_fact with subject "parallel-tool" and count_stream_events with label "parallel-tool" in parallel in the same response turn. After both tool results return, reply with exactly this text and nothing else: parallel tools complete',
				options: {
					model: 'claude-sonnet-4-5',
					tools: [],
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 3,
					allowedTools: ['mcp__testserver__lookup_stream_fact', 'mcp__testserver__count_stream_events'],
					mcpServers: {
						testserver: createSdkMcpServer({ name: 'testserver', tools: [lookupTool, countTool] }),
					},
					includePartialMessages: true,
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'stream_event') {
					console.log(item)

					if (item.event.type === 'message_start') {
						activeToolUseMessageDepth = 0
					}

					if (item.event.type === 'content_block_start' && item.event.content_block.type === 'tool_use') {
						console.log(JSON.stringify(item.event.content_block, null, 2))
						streamedToolStarts.push({
							index: item.event.index,
							name: item.event.content_block.name,
							id: item.event.content_block.id,
						})
						activeToolUseMessageDepth += 1
					}

					if (item.event.type === 'content_block_delta' && item.event.delta.type === 'input_json_delta') {
						const chunks = streamedToolInputChunks.get(item.event.index) ?? []
						chunks.push(item.event.delta.partial_json)
						streamedToolInputChunks.set(item.event.index, chunks)
					}

					if (item.event.type === 'message_delta' && item.event.delta.stop_reason === 'tool_use') {
						expect(activeToolUseMessageDepth).toBeGreaterThanOrEqual(2)
					}
				}

				if (item.type !== 'stream_event') {
					console.log(JSON.stringify(item, null, 2))
				}

				if (item.type === 'assistant') {
					for (const contentBlock of item.message.content) {
						if (contentBlock.type === 'tool_use') {
							expect([
								'mcp__testserver__lookup_stream_fact',
								'mcp__testserver__count_stream_events',
							]).toContain(contentBlock.name)
							completedToolUses.push({
								id: contentBlock.id,
								name: contentBlock.name,
								input: contentBlock.input,
							})
						}

						if (contentBlock.type === 'text' && toolResults.length >= 2) {
							expect(contentBlock.text.length).toBeGreaterThan(0)
							sawFinalText = true
						}
					}
				}

				if (item.type === 'user') {
					for (const contentBlock of item.message.content) {
						if (typeof contentBlock !== 'string' && contentBlock.type === 'tool_result') {
							console.log(JSON.stringify(contentBlock, null, 2))
							toolResults.push(contentBlock.tool_use_id)
						}
					}
				}
			}

			expect(streamedToolStarts.length).toBeGreaterThanOrEqual(2)
			expect(new Set(streamedToolStarts.map((toolStart) => toolStart.index)).size).toBeGreaterThanOrEqual(2)
			expect(completedToolUses.length).toBeGreaterThanOrEqual(2)
			expect(toolResults.length).toBeGreaterThanOrEqual(2)
			expect(toolResults).toEqual(expect.arrayContaining(completedToolUses.map((toolUse) => toolUse.id)))
			for (const completedToolUse of completedToolUses) {
				const streamedToolStart = streamedToolStarts.find((toolStart) => toolStart.id === completedToolUse.id)
				if (!streamedToolStart) throw new Error(`expected streamed tool start for ${completedToolUse.id}`)
				const partialJson = (streamedToolInputChunks.get(streamedToolStart.index) ?? []).join('')
				expect(JSON.parse(partialJson)).toEqual(completedToolUse.input)
			}
			expect(sawFinalText).toBe(true)
		})
	})

	describe('sub-agent streaming', () => {
		test('streams Agent tool use, but does not stream nested sub-agent events', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-subagent-streaming-'))
			tempDirs.push(cwd)
			const markerPath = join(cwd, 'sub-agent-marker.txt')
			let agentToolUseId: string | undefined
			let sawMainAgentEvent = false
			let sawAgentToolUse = false
			let sawNestedStreamEvent = false
			let sawFinalText = false

			const queryResult = query({
				prompt: `Dispatch a sub-agent to write exactly "sub-agent-ran" to ${markerPath}. After the sub-agent returns, reply with exactly this text and nothing else: sub agent complete`,
				options: {
					model: 'claude-sonnet-4-5',
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 5,
					tools: ['Agent', 'Write'],
					allowedTools: ['Agent', 'Write'],
					includePartialMessages: true,
					thinking: { type: 'enabled', budgetTokens: 8192, display: 'summarized' },
					effort: 'max',
					env: {
						...process.env,
						CLAUDE_CODE_EFFORT_LEVEL: 'high',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'stream_event') {
					console.log(item)
					if (item.parent_tool_use_id === null) {
						sawMainAgentEvent = true
					}

					if (item.parent_tool_use_id !== null) {
						sawNestedStreamEvent = true
					}
				}

				if (item.type === 'assistant') {
					for (const contentBlock of item.message.content) {
						if (contentBlock.type === 'tool_use' && contentBlock.name === 'Agent') {
							expect(item.parent_tool_use_id).toBe(null)
							expect(contentBlock.id.length).toBeGreaterThan(0)
							agentToolUseId = contentBlock.id
							sawAgentToolUse = true
						}

						if (contentBlock.type === 'text' && sawAgentToolUse) {
							expect(item.parent_tool_use_id).toBe(null)
							expect(contentBlock.text.length).toBeGreaterThan(0)
							sawFinalText = true
						}
					}
				}

				if (item.type === 'user') {
					for (const contentBlock of item.message.content) {
						if (typeof contentBlock !== 'string' && contentBlock.type === 'tool_result') {
							if (contentBlock.tool_use_id === agentToolUseId) {
								expect(item.parent_tool_use_id).toBe(null)
							}
						}
					}
				}
			}

			expect(sawMainAgentEvent).toBe(true)
			expect(sawAgentToolUse).toBe(true)
			expect(sawNestedStreamEvent).toBe(false)
			expect(sawFinalText).toBe(true)
			expect(await readFile(markerPath, 'utf8')).toBe('sub-agent-ran')
		})
	})

	describe('resume streaming', () => {
		test('restarts content block indices from zero after resuming a session', async () => {
			const cwd = await mkdtemp(join(tmpdir(), 'riptide-daemon-resume-streaming-'))
			tempDirs.push(cwd)
			let sessionId: string | undefined
			const firstContentBlockStartIndices: number[] = []
			const resumedContentBlockStartIndices: number[] = []

			const firstQuery = query({
				prompt: 'Reply with exactly this text and nothing else: first resume turn',
				options: {
					cwd,
					permissionMode: 'bypassPermissions',
					maxTurns: 1,
					allowedTools: [],
					includePartialMessages: true,
				},
			})

			for await (const item of firstQuery) {
				if (item.session_id) {
					sessionId = item.session_id
				}

				if (item.type === 'stream_event' && item.event.type === 'content_block_start') {
					console.log(item)
					firstContentBlockStartIndices.push(item.event.index)
				}
			}

			if (!sessionId) throw new Error('expected first query to produce a session id')

			const resumedQuery = query({
				prompt: 'Reply with exactly this text and nothing else: second resume turn',
				options: {
					cwd,
					resume: sessionId,
					permissionMode: 'bypassPermissions',
					maxTurns: 1,
					allowedTools: [],
					includePartialMessages: true,
				},
			})

			for await (const item of resumedQuery) {
				if (item.type === 'stream_event' && item.event.type === 'content_block_start') {
					console.log(item)
					resumedContentBlockStartIndices.push(item.event.index)
				}
			}

			expect(firstContentBlockStartIndices[0]).toBe(0)
			expect(resumedContentBlockStartIndices[0]).toBe(0)
		})
	})
})
