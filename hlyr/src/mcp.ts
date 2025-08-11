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

const MAX_POLLING_ERRORS = 3
const POLLING_RETRY_DELAY = 1000

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
    // Log the complete request from Claude to see if there's any ID we're missing
    logger.error('process.env', process.env)
    logger.error('Full tool call request from Claude', {
      name: request.params.name,
      arguments: request.params.arguments,
      fullRequest: JSON.stringify(request),
    })

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

      logger.info('Processing approval request', {
        runId,
        toolName,
        toolInput: JSON.stringify(input),
      })

      let currentDaemonClient = daemonClient

      try {
        // Connect to daemon
        logger.debug('Connecting to daemon...')
        await currentDaemonClient.connect()
        logger.debug('Connected to daemon')

        // Create approval request with full input logging
        logger.debug('Creating approval request with full payload', {
          runId,
          toolName,
          toolInput: JSON.stringify(input),
        })
        const createResponse = await currentDaemonClient.createApproval(runId, toolName, input)
        const approvalId = createResponse.approval_id
        logger.info('Created approval', { approvalId })

        // Poll for approval status with reconnection resilience
        let approved = false
        let comment = ''
        let polling = true
        let errorCount = 0

        while (polling) {
          try {
            // Get the specific approval by ID
            logger.debug('Fetching approval status...', { approvalId })
            const approval = (await currentDaemonClient.getApproval(approvalId)) as {
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

            // Reset error count on successful poll
            errorCount = 0
          } catch (error) {
            errorCount++
            logger.error(`Polling error (attempt ${errorCount}/${MAX_POLLING_ERRORS}):`, {
              error,
              approvalId,
            })

            if (errorCount >= MAX_POLLING_ERRORS) {
              // Notify daemon about MCP polling failure before throwing
              try {
                await currentDaemonClient.reportMCPFailure?.(approvalId, 'polling_failed', {
                  error: error instanceof Error ? error.message : String(error),
                  attempts: errorCount,
                })
              } catch (reportError) {
                logger.error('Failed to report MCP failure to daemon:', reportError)
              }

              throw new McpError(
                ErrorCode.InternalError,
                `Failed to poll approval status after ${MAX_POLLING_ERRORS} attempts: ${error instanceof Error ? error.message : String(error)}`,
              )
            }

            // Try to reconnect if we got a connection error
            const errorMessage = error instanceof Error ? error.message : String(error)
            if (errorMessage.includes('EPIPE') || errorMessage.includes('ECONNRESET')) {
              try {
                logger.info('Connection error detected, attempting to reconnect...')
                await currentDaemonClient.close()
                currentDaemonClient = new DaemonClient(socketPath)
                await currentDaemonClient.connect()
                logger.info('Successfully reconnected to daemon')
              } catch (reconnectError) {
                logger.error('Failed to reconnect:', reconnectError)
              }
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, POLLING_RETRY_DELAY))
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
        currentDaemonClient.close()
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
