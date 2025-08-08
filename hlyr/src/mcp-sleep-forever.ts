#!/usr/bin/env tsx
/**
 * Test MCP server that sleeps forever when receiving approval requests
 * Used to test Claude CLI behavior when killed during approval waiting
 *
 * Usage: npx tsx mcp-sleep-forever.ts
 */

import { createServer } from '@connectrpc/connect'
import { ConnectRouter } from '@connectrpc/connect'
import { ConnectTransportOptions } from '@connectrpc/connect-node'
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify'
import fastify from 'fastify'
import { readFileSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Log file for debugging (can't use stdout/stderr as MCP uses those)
const LOG_FILE = join(homedir(), '.humanlayer', 'logs', 'mcp-sleep-forever.log')

function log(message: string) {
  const timestamp = new Date().toISOString()
  const logEntry = `[${timestamp}] ${message}\n`
  try {
    appendFileSync(LOG_FILE, logEntry)
  } catch (error) {
    // Ignore logging errors
  }
}

// MCP protocol types
interface MCPRequest {
  jsonrpc: string
  method: string
  params?: any
  id?: number | string
}

interface MCPResponse {
  jsonrpc: string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
  id?: number | string
}

// Simple JSON-RPC handler
async function handleRequest(request: MCPRequest): Promise<MCPResponse> {
  log(`Received request: ${JSON.stringify(request)}`)

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: {
            name: 'mcp-sleep-forever',
            version: '1.0.0',
          },
        },
        id: request.id,
      }

    case 'initialized':
      return {
        jsonrpc: '2.0',
        result: {},
        id: request.id,
      }

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'request_permission',
              description: 'Request permission to perform an action - THIS WILL SLEEP FOREVER',
              inputSchema: {
                type: 'object',
                properties: {
                  tool_name: {
                    type: 'string',
                    description: 'Name of the tool to request permission for',
                  },
                  input: { type: 'object', description: 'Input parameters for the tool' },
                },
                required: ['tool_name', 'input'],
              },
            },
          ],
        },
        id: request.id,
      }

    case 'tools/call':
      if (request.params?.name === 'request_permission') {
        log(`Received approval request - SLEEPING FOREVER: ${JSON.stringify(request.params)}`)
        log(
          'Process will now sleep indefinitely. Kill the Claude process to test interruption behavior.',
        )

        // Sleep forever - this simulates a stuck approval
        await new Promise(() => {}) // Never resolves

        // This code will never be reached
        return {
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: 'This should never be seen',
              },
            ],
          },
          id: request.id,
        }
      }
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found',
        },
        id: request.id,
      }

    default:
      return {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Method not found',
        },
        id: request.id,
      }
  }
}

// Main server loop
async function main() {
  log('MCP sleep-forever server starting...')

  // Read from stdin, write to stdout (MCP protocol)
  process.stdin.setEncoding('utf8')

  let buffer = ''

  process.stdin.on('data', async chunk => {
    buffer += chunk

    // Process complete messages
    while (buffer.includes('\n')) {
      const lineEnd = buffer.indexOf('\n')
      const line = buffer.slice(0, lineEnd)
      buffer = buffer.slice(lineEnd + 1)

      if (line.trim()) {
        try {
          const request = JSON.parse(line) as MCPRequest
          const response = await handleRequest(request)
          process.stdout.write(JSON.stringify(response) + '\n')
        } catch (error) {
          log(`Error processing request: ${error}`)
          const errorResponse: MCPResponse = {
            jsonrpc: '2.0',
            error: {
              code: -32700,
              message: 'Parse error',
            },
          }
          process.stdout.write(JSON.stringify(errorResponse) + '\n')
        }
      }
    }
  })

  process.stdin.on('end', () => {
    log('Input stream ended')
    process.exit(0)
  })

  // Handle termination
  process.on('SIGTERM', () => {
    log('Received SIGTERM')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    log('Received SIGINT')
    process.exit(0)
  })

  log('MCP server ready and waiting for requests...')
}

// Start the server
main().catch(error => {
  log(`Fatal error: ${error}`)
  process.exit(1)
})
