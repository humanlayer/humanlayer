import { query } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'

const DEBUG = process.env.DEBUG

describe('Claude Agent SDK Tool Search Learning Tests', async () => {
	describe('With Claude Code Toolset', async () => {
		test('Disabling tool search should not show deferred tools', async () => {
			const queryResult = query({
				prompt: '/context',
				options: {
					tools: { type: 'preset', preset: 'claude_code' },
					env: {
						...process.env,
						ENABLE_TOOL_SEARCH: 'false',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'assistant') {
					expect(item.message.content[0]!.type).toBe('text')
					if (item.message.content[0]!.type === 'text') {
						const content = item.message.content[0]!.text
						if (DEBUG) console.log(content)

						expect(content).not.toContain('deferred')
					}
				}
			}
		})

		test('Enabling tool search should show deterred tools', async () => {
			const queryResult = query({
				prompt: '/context',
				options: {
					tools: { type: 'preset', preset: 'claude_code' },
					env: {
						...process.env,
						ENABLE_TOOL_SEARCH: 'true',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'assistant') {
					expect(item.message.content[0]!.type).toBe('text')
					if (item.message.content[0]!.type === 'text') {
						const content = item.message.content[0]!.text
						if (DEBUG) console.log(content)

						expect(content).toContain('deferred')
					}
				}
			}
		})
	})

	describe('With Custom toolset', async () => {
		test('Custom toolset does not show tool search', async () => {
			const queryResult = query({
				prompt: '/context',
				options: {
					tools: ['Read', 'Write', 'Bash'],
					env: {
						...process.env,
						ENABLE_TOOL_SEARCH: 'true',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'assistant') {
					expect(item.message.content[0]!.type).toBe('text')
					if (item.message.content[0]!.type === 'text') {
						const content = item.message.content[0]!.text
						if (DEBUG) console.log(content)

						expect(content).not.toContain('deferred')
					}
				}
			}
		})

		test('Custom toolset with ToolSearch tool does show tool search', async () => {
			const queryResult = query({
				prompt: '/context',
				options: {
					tools: ['Read', 'Write', 'Bash', 'ToolSearch', 'Agent', 'Monitor', 'Grep', 'Glob', 'Bash'],
					env: {
						...process.env,
						ENABLE_TOOL_SEARCH: 'true',
					},
				},
			})

			for await (const item of queryResult) {
				if (item.type === 'assistant') {
					expect(item.message.content[0]!.type).toBe('text')
					if (item.message.content[0]!.type === 'text') {
						const content = item.message.content[0]!.text
						console.log(content)

						expect(content).toContain('deferred')
					}
				}
			}
		})
	})
})
