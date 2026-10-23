import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, test } from 'vitest'
import { z } from 'zod/v4'

const createTools = (options: { count: number }) => {
	const { count = 100 } = options

	return new Array(count).fill(0).map((_: unknown, index: number) => {
		return tool(
			`test_tool_${index}`,
			'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?',
			z.object({}).shape,
			async (args) => {
				console.log(`Tool ${index} was called!`)
				return { content: [{ type: 'text', text: `This is a tool result for tool ${index} out of ${count}` }] }
			},
		)
	})
}

describe('MCP Tool Offloading tests', async () => {
	test.skip('0 MCP tools should not trigger offloading', async () => {
		const queryResult = query({
			prompt: '/context',
			options: {
				tools: { type: 'preset', preset: 'claude_code' },
				env: {
					...process.env,
					ENABLE_TOOL_SEARCH: 'auto:5',
				},
			},
		})

		for await (const item of queryResult) {
			if (item.type === 'assistant') {
				expect(item.message.content[0]!.type).toBe('text')
				if (item.message.content[0]!.type === 'text') {
					const content = item.message.content[0]!.text
					expect(content).not.toContain('deferred')
				}
			}
		}
	})

	test('Fuck-ton of MCP tools should offload when using claude code toolset', async () => {
		const tools = createTools({ count: 100 })
		const queryResult = query({
			prompt: '/context',
			options: {
				tools: { type: 'preset', preset: 'claude_code' },
				env: {
					...process.env,
					ENABLE_TOOL_SEARCH: 'auto:5',
				},
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools }),
				},
			},
		})

		for await (const item of queryResult) {
			if (item.type === 'assistant') {
				expect(item.message.content[0]!.type).toBe('text')
				if (item.message.content[0]!.type === 'text') {
					const content = item.message.content[0]!.text
					expect(content).toContain('deferred')
				}
			}
		}
	})

	test('Fuck-ton of MCP tools should offload when using custom toolset', async () => {
		const tools = createTools({ count: 100 })
		const queryResult = query({
			prompt: '/context',
			options: {
				model: 'claude-opus-4-6',
				tools: ['Read', 'Write', 'ToolSearch', 'Bash'],
				env: {
					...process.env,
					CLAUDE_CODE_EFFORT_LEVEL: 'high',
					CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
					CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
					CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
					// NOTE no experimental betas
					ENABLE_TOOL_SEARCH: 'auto:5',
				},
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools }),
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

	test('Fuck-ton of MCP tools does NOT offload when experimental betas is set even when explicitly enbaled', async () => {
		const tools = createTools({ count: 100 })
		const queryResult = query({
			prompt: '/context',
			options: {
				model: 'claude-opus-4-6',
				tools: ['Read', 'Write', 'ToolSearch', 'Bash'],
				env: {
					...process.env,
					CLAUDE_CODE_EFFORT_LEVEL: 'high',
					CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',

					CLAUDE_CODE_DISABLE_CRON: '1', // Disables cron tool
					CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
					CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
					// NOTE: the CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS variable turns off lots of things - many are explicitly disabled
					// but setting the variable also disables tool search which we need for enterprise customers
					// so it is re-enabled
					//CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
					ENABLE_TOOL_SEARCH: 'auto:5',

					// Other stuff
					CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '0', // TODO set to 1 to disable
					CLAUDE_AGENT_SDK_MCP_NO_PREFIX: '0', // NOTE this will disable mcp__<server>_ tool prefixes - good for our custom stuff but NOT for customer mcp stuff
				},
				mcpServers: {
					testserver: createSdkMcpServer({ name: 'testserver', tools }),
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
