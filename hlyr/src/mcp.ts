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
import { logger } from './mcpLogger.js'

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
  logger.info('Starting Claude approvals MCP server')
  logger.info('Environment variables', {
    HUMANLAYER_DAEMON_SOCKET: process.env.HUMANLAYER_DAEMON_SOCKET,
    HUMANLAYER_RUN_ID: process.env.HUMANLAYER_RUN_ID,
  })

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

  // Create daemon client with socket path from environment or config
  // The daemon sets HUMANLAYER_DAEMON_SOCKET for MCP servers it launches
  const resolvedConfig = resolveFullConfig({})
  const socketPath = process.env.HUMANLAYER_DAEMON_SOCKET || resolvedConfig.daemon_socket
  logger.info('Creating daemon client', { socketPath })
  const daemonClient = new DaemonClient(socketPath)

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info('ListTools request received')
    const tools = [
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
    ]
    logger.info('Returning tools', { tools })
    return { tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async request => {
    logger.debug('Received tool call request', { name: request.params.name })

    if (request.params.name === 'request_permission') {
      const toolName: string | undefined = request.params.arguments?.tool_name

      if (!toolName) {
        logger.error('Invalid tool name in request_permission', request.params.arguments)
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name requesting permissions')
      }

      const input: Record<string, unknown> = request.params.arguments?.input || {}

      // Get run ID from environment (set by Claude Code)
      const runId = process.env.HUMANLAYER_RUN_ID
      if (!runId) {
        logger.error('HUMANLAYER_RUN_ID not set in environment')
        throw new McpError(ErrorCode.InternalError, 'HUMANLAYER_RUN_ID not set')
      }

      logger.info('Processing approval request', { runId, toolName })

      try {
        // Connect to daemon
        logger.debug('Connecting to daemon...')
        await daemonClient.connect()
        logger.debug('Connected to daemon')

        // Create approval request
        logger.debug('Creating approval request...', { runId, toolName })
        const createResponse = await daemonClient.createApproval(runId, toolName, input)
        const approvalId = createResponse.approval_id
        logger.info('Created approval', { approvalId })

        // Poll for approval status
        let approved = false
        let comment = ''
        let polling = true

        while (polling) {
          try {
            // Get the specific approval by ID
            logger.debug('Fetching approval status...', { approvalId })
            const approval = (await daemonClient.getApproval(approvalId)) as {
              id: string
              status: string
              comment?: string
            }

            logger.debug('Approval status', { status: approval.status })

            if (approval.status !== 'pending') {
              // Approval has been resolved
              approved = approval.status === 'approved'
              comment = approval.comment || ''
              polling = false
              logger.info('Approval resolved', {
                approvalId,
                status: approval.status,
                approved,
              })
            } else {
              // Still pending, wait and poll again
              logger.debug('Approval still pending, polling again...')
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          } catch (error) {
            logger.error('Failed to get approval status', { error, approvalId })
            // Re-throw the error since this is a critical failure
            throw new McpError(ErrorCode.InternalError, 'Failed to get approval status')
          }
        }

        if (!approved) {
          logger.info('Approval denied', { approvalId, comment })
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

        logger.info('Approval granted', { approvalId })
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
        logger.error('Failed to process approval', error)
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to process approval: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        logger.debug('Closing daemon connection')
        daemonClient.close()
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name')
  })

  const transport = new StdioServerTransport()

  try {
    await server.connect(transport)
    logger.info('MCP server connected and ready')
  } catch (error) {
    logger.error('Failed to start MCP server', error)
    throw error
  }
}
