import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { resolveFullConfig } from './config.js'
import { DaemonClient } from './daemonClient.js'
import { logger } from './mcpLogger.js'

/**
 * Start the Claude approvals MCP server that provides request_permission functionality
 * Returns responses in the format required by Claude Code SDK
 *
 * This uses local approvals through the daemon instead of HumanLayer API
 */
export async function startClaudeApprovalsMCPServer() {
  // No auth validation needed - uses local daemon
  logger.info('Starting Claude approvals MCP server')
  logger.info('Environment variables', {
    HUMANLAYER_DAEMON_SOCKET: process.env.HUMANLAYER_DAEMON_SOCKET,
    HUMANLAYER_SESSION_ID: process.env.HUMANLAYER_SESSION_ID,
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
            tool_use_id: { type: 'string' }, // Added for Phase 2
          },
          required: ['tool_name', 'input', 'tool_use_id'],
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
      const toolUseId: string | undefined = request.params.arguments?.tool_use_id // Phase 2

      if (!toolName) {
        logger.error('Invalid tool name in request_permission', request.params.arguments)
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid tool name requesting permissions')
      }

      const input: Record<string, unknown> = request.params.arguments?.input || {}

      // Get session ID from environment (set by daemon)
      const sessionId = process.env.HUMANLAYER_SESSION_ID
      if (!sessionId) {
        logger.error('HUMANLAYER_SESSION_ID not set in environment')
        throw new McpError(ErrorCode.InternalError, 'HUMANLAYER_SESSION_ID not set')
      }

      logger.info('Processing approval request', { sessionId, toolName, toolUseId })

      try {
        // Connect to daemon
        logger.debug('Connecting to daemon...')
        await daemonClient.connect()
        logger.debug('Connected to daemon')

        // Create approval request with tool use ID (Phase 2)
        logger.debug('Creating approval request...', { sessionId, toolName, toolUseId })
        const createResponse = await daemonClient.createApproval(sessionId, toolName, input, toolUseId)
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
