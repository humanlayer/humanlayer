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
import { DaemonClient } from './daemonClient.js'

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

  const resolvedConfig = resolveFullConfig({})

  const hl = humanlayer({
    apiKey: resolvedConfig.api_key,
    ...(resolvedConfig.api_base_url && { apiBaseUrl: resolvedConfig.api_base_url }),
    ...(resolvedConfig.run_id && { runId: resolvedConfig.run_id }),
    ...(Object.keys(resolvedConfig.contact_channel).length > 0 && {
      contactChannel: resolvedConfig.contact_channel,
    }),
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
 *
 * This now uses local approvals through the daemon instead of HumanLayer API
 */
export async function startClaudeApprovalsMCPServer() {
  // No auth validation needed - uses local daemon

  const server = new Server(
    {
      name: 'humanlayer-claude-local-approvals',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // Create daemon client
  const daemonClient = new DaemonClient()

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
    if (request.params.name === 'request_permission') {
      const toolName: string | undefined = request.params.arguments?.tool_name

      if (!toolName) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name requesting permissions')
      }

      const input: Record<string, unknown> = request.params.arguments?.input || {}

      // Get run ID from environment (set by Claude Code)
      const runId = process.env.HUMANLAYER_RUN_ID
      if (!runId) {
        throw new McpError(ErrorCode.InternalError, 'HUMANLAYER_RUN_ID not set')
      }

      try {
        // Connect to daemon
        await daemonClient.connect()

        // Create approval request
        const createResponse = await daemonClient.createApproval(runId, toolName, input)
        const approvalId = createResponse.approval_id

        // Poll for approval status
        let approved = false
        let comment = ''
        let polling = true

        while (polling) {
          // Get session ID from run ID (we need to fetch session info first)
          const sessionsResponse = (await daemonClient.listSessions()) as {
            sessions: Array<{ id: string; run_id: string }>
          }
          const session = sessionsResponse.sessions.find(s => s.run_id === runId)

          if (!session) {
            throw new McpError(ErrorCode.InternalError, 'Session not found for run ID')
          }

          // Fetch approvals for the session
          const approvals = (await daemonClient.fetchApprovals(session.id)) as Array<{
            id: string
            status: string
            comment?: string
          }>

          const approval = approvals.find(a => a.id === approvalId)

          if (approval && approval.status !== 'pending') {
            approved = approval.status === 'approved'
            comment = approval.comment || ''
            polling = false
          } else {
            // Wait 1 second before polling again
            await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }

        if (!approved) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  behavior: 'deny',
                  message: comment || 'Request denied by human reviewer',
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
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to process approval: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        daemonClient.close()
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name')
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
