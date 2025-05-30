import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { humanlayer } from '@humanlayer/sdk'
import { resolveFullConfig } from './config.js'

function validateAuth(): void {
  const config = resolveFullConfig({})

  if (!config.api_key) {
    console.error('Error: No HumanLayer API token found.')
    console.error('Please set HUMANLAYER_API_KEY environment variable or run `humanlayer login`')
    process.exit(1)
  }
}

/**
 * Start the default MCP server that provides contact_human functionality
 * Uses web UI by default when no contact channel is configured
 */
export async function startDefaultMCPServer() {
  validateAuth()

  const server = new Server(
    {
      name: 'humanlayer-standalone',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Use run_id from env if provided
  const runId = process.env.HUMANLAYER_RUN_ID

  const hl = humanlayer({
    ...(runId && { runId }),
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'contact_human',
          description: 'Contact a human for assistance',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      ],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name === 'contact_human') {
      const response = await hl.fetchHumanResponse({
        spec: {
          msg: request.params.arguments?.message,
        },
      })

      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name')
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

/**
 * Start the Claude approvals MCP server that provides request_permission functionality
 * Returns responses in the format required by Claude Code SDK
 */
export async function startClaudeApprovalsMCPServer() {
  validateAuth()

  const server = new Server(
    {
      name: 'humanlayer-claude-approvals',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Use run_id from env if provided
  const runId = process.env.HUMANLAYER_RUN_ID

  const hl = humanlayer({
    ...(runId && { runId }),
  })

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'request_permission',
          description: 'Request permission to perform an action',
          inputSchema: {
            type: 'object',
            properties: {
              tool_name: { type: 'string' },
              input: { type: 'object' },
            },
            required: ['tool_name', 'input'],
          },
        },
      ],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async request => {
    /**
     * example input
     * {
     *  "tool_name": "Write",
     *  "input": {
     *    "file_name": "hello.txt"
     *    "content": "Hello, how are you?"
     *  }
     * }
     */
    if (request.params.name === 'request_permission') {
      const toolName: string | undefined = request.params.arguments?.tool_name

      if (!toolName) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name requesting permissions')
      }

      const input: Record<string, unknown> = request.params.arguments?.input || {}

      const approvalResult = await hl.fetchHumanApproval({
        spec: {
          fn: toolName,
          kwargs: input,
        },
      })

      if (!approvalResult.approved) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                behavior: 'deny',
                message: approvalResult.comment || 'Request denied by human reviewer',
              }),
            },
          ],
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'allow',
              updatedInput: input,
            }),
          },
        ],
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name')
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
