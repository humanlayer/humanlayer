#!/usr/bin/env bun

import { connectWithRetry, DaemonClient, Approval } from '../src/daemonClient.js'
import { homedir } from 'os'
import { join } from 'path'
import * as fs from 'fs/promises'
import { spawn } from 'child_process'
import { Database } from 'bun:sqlite'
import { parseArgs } from 'util'

// Configuration
const SOCKET_PATH = join(homedir(), '.humanlayer', 'daemon.sock')
const DB_PATH = join(homedir(), '.humanlayer', 'daemon.db')
const MCP_LOG_DIR = join(homedir(), '.humanlayer', 'logs')

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

function log(level: 'info' | 'success' | 'error' | 'debug' | 'mcp', message: string) {
  const timestamp = new Date().toISOString()
  const color = {
    info: colors.blue,
    success: colors.green,
    error: colors.red,
    debug: colors.cyan,
    mcp: colors.magenta,
  }[level]

  console.log(`${color}[${timestamp}] [${level.toUpperCase()}] ${message}${colors.reset}`)
}

// Monitor MCP logs in real-time
async function monitorMCPLogs(runId: string): Promise<() => void> {
  const logPath = join(MCP_LOG_DIR, `mcp-claude-approvals-${runId}.log`)
  log('info', `Monitoring MCP logs at: ${logPath}`)

  // Wait for log file to exist
  let attempts = 0
  while (attempts < 10) {
    try {
      await fs.access(logPath)
      break
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
      attempts++
    }
  }

  // Create a tail-like process to follow the log
  const tail = spawn('tail', ['-f', logPath])

  tail.stdout.on('data', data => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        const prefix = `[${entry.level}] ${entry.message}`
        const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
        log('mcp', `${prefix}${dataStr}`)
      } catch {
        // Not JSON, just print as-is
        log('mcp', line)
      }
    }
  })

  tail.stderr.on('data', data => {
    log('error', `MCP log error: ${data}`)
  })

  // Return cleanup function
  return () => {
    tail.kill()
  }
}

// Launch a session that will definitely trigger an approval
async function launchApprovalSession(client: DaemonClient, testFile: string) {
  log('info', 'Launching session that will trigger file write approval...')

  const launchRequest = {
    query: `Please write the text "Hello from MCP approval test!" to a file named "${testFile}". This is a test of the approval system.`,
    working_dir: process.cwd(),
    mcp_config: {
      mcpServers: {
        approvals: {
          command: 'npm',
          args: ['run', 'dev', 'mcp', 'claude_approvals'],
          env: {
            ...process.env,
            HUMANLAYER_MCP_DEBUG: 'true',
          },
        },
      },
    },
    permission_prompt_tool: 'mcp__approvals__request_permission',
  }

  const session = await client.launchSession(launchRequest)
  log('success', `Session launched: ${session.session_id}`)
  log('info', `Run ID: ${session.run_id}`)

  return session
}

// Launch a session for interactive monitoring
async function launchInteractiveSession(client: DaemonClient, query?: string) {
  // Generate random content to ensure approval is always triggered
  const timestamp = new Date().toISOString()
  const randomId = Math.random().toString(36).substring(7)
  const defaultQuery = `Please write "Hello from HumanLayer MCP test!\nTimestamp: ${timestamp}\nTest ID: ${randomId}" to a file named blah.txt`
  const userQuery = query || defaultQuery

  log('info', 'Launching interactive session...')
  log('info', `Query: ${userQuery}`)

  const launchRequest = {
    query: userQuery,
    working_dir: process.cwd(),
    mcp_config: {
      mcpServers: {
        approvals: {
          command: 'npm',
          args: ['run', 'dev', 'mcp', 'claude_approvals'],
          env: {
            ...process.env,
            HUMANLAYER_MCP_DEBUG: 'true',
          },
        },
      },
    },
    permission_prompt_tool: 'mcp__approvals__request_permission',
  }

  const session = await client.launchSession(launchRequest)
  log('success', `Session launched: ${session.session_id}`)
  log('info', `Run ID: ${session.run_id}`)

  return session
}

// Automated test mode
async function runAutomatedTest() {
  log('info', '=== Automated MCP Approval Test ===\n')

  // Enable MCP debug logging
  process.env.HUMANLAYER_MCP_DEBUG = 'true'

  // Connect to daemon
  const client = await connectWithRetry(SOCKET_PATH, 3, 1000)
  log('success', 'Connected to daemon')

  try {
    // Generate test file name
    const testFile = `test-mcp-approval-${Date.now()}.txt`
    log('info', `Test file: ${testFile}`)

    // Launch session
    const session = await launchApprovalSession(client, testFile)

    // Start monitoring MCP logs
    const stopMonitoring = await monitorMCPLogs(session.run_id)

    // Subscribe to approval events
    const eventEmitter = await client.subscribe({
      event_types: ['new_approval', 'approval_resolved'],
      session_id: session.session_id,
    })

    let approvalReceived = false
    let approvalId: string | null = null

    eventEmitter.on('event', event => {
      if (event.type === 'new_approval') {
        log('success', `New approval event received!`)
        log('debug', `Event data: ${JSON.stringify(event.data)}`)
        approvalReceived = true
      } else if (event.type === 'approval_resolved') {
        log('success', `Approval resolved: ${JSON.stringify(event.data)}`)
      }
    })

    // Wait for approval to be created
    log('info', 'Waiting for Claude to request file write approval...')
    const maxWait = 30000 // 30 seconds
    const startTime = Date.now()

    while (!approvalId && Date.now() - startTime < maxWait) {
      // Check database for approvals using Bun's native SQLite
      const db = new Database(DB_PATH, { readonly: true })

      const stmt = db.prepare('SELECT * FROM approvals WHERE session_id = ? AND status = "pending"')
      const approvals = stmt.all(session.session_id) as Approval[]

      if (approvals.length > 0) {
        const approval = approvals[0]
        approvalId = approval.id
        log('success', `Approval found in database: ${approvalId}`)
        log('debug', `Tool: ${approval.tool_name}`)
        log('debug', `Input: ${approval.tool_input}`)

        // Auto-approve after a short delay
        log('info', 'Auto-approving in 2 seconds...')
        await new Promise(resolve => setTimeout(resolve, 2000))

        try {
          await client.sendDecision(approvalId, 'approve', 'Automated test approval')
          log('success', '✓ Approval sent successfully')

          // Wait for file to be created
          await new Promise(resolve => setTimeout(resolve, 3000))

          // Check if file was created
          try {
            await fs.access(testFile)
            log('success', `✓ File "${testFile}" was created successfully`)

            // Read and display content
            const content = await fs.readFile(testFile, 'utf-8')
            log('info', `File content: ${content}`)

            // Clean up test file
            await fs.unlink(testFile)
            log('info', 'Test file cleaned up')
          } catch {
            log('error', 'File was not created - approval may have failed')
          }
        } catch (error) {
          log('error', `Failed to approve: ${error}`)
        }
      }

      db.close()

      if (!approvalId) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    if (!approvalId) {
      log('error', 'No approval was requested within timeout period')
    }

    // Analyze MCP logs
    const mcpLogPath = join(MCP_LOG_DIR, `mcp-claude-approvals-${session.run_id}.log`)
    try {
      const logs = await fs.readFile(mcpLogPath, 'utf-8')
      const logLines = logs.split('\n').filter(Boolean)

      log('info', `\nMCP Log Summary:`)
      log('info', `Total entries: ${logLines.length}`)

      const errors = logLines.filter(l => l.includes('"level":"ERROR"'))
      if (errors.length > 0) {
        log('error', `Found ${errors.length} errors in MCP logs`)
      } else {
        log('success', '✓ No errors in MCP logs')
      }
    } catch (error) {
      log('error', `Could not analyze MCP logs: ${error}`)
    }

    // Summary
    log('info', '\n=== Test Summary ===')
    log('success', '✓ Session launched with MCP approvals')
    log('success', '✓ MCP logs monitored successfully')

    if (approvalReceived) {
      log('success', '✓ Approval event received via subscription')
    }

    if (approvalId) {
      log('success', '✓ Approval created and processed')
    }

    stopMonitoring()
  } finally {
    client.close()
    // Exit cleanly after test completes
    process.exit(0)
  }
}

// Interactive monitoring mode
async function runInteractiveMode(query?: string) {
  log('info', '=== Interactive MCP Monitoring Mode ===\n')

  // Enable MCP debug logging
  process.env.HUMANLAYER_MCP_DEBUG = 'true'

  // Connect to daemon
  const client = await connectWithRetry(SOCKET_PATH, 3, 1000)
  log('success', 'Connected to daemon')

  try {
    // Launch session
    const session = await launchInteractiveSession(client, query)

    // Start monitoring MCP logs
    const stopMonitoring = await monitorMCPLogs(session.run_id)

    // Subscribe to approval events
    const eventEmitter = await client.subscribe({
      event_types: ['new_approval', 'approval_resolved', 'session_status_changed'],
      session_id: session.session_id,
    })

    let sessionCompleted = false

    eventEmitter.on('event', event => {
      if (event.type === 'new_approval') {
        log('success', '\n🔔 NEW APPROVAL REQUEST!')
        log('info', `Approval ID: ${event.data.approval_id}`)
        log('info', `Tool: ${event.data.tool_name || 'N/A'}`)
        log('info', '\nYou can approve/deny this in:')
        log('info', '  - WUI: Open the desktop app')
        log('info', `  - Session URL: #/sessions/${session.session_id}\n`)
      } else if (event.type === 'approval_resolved') {
        const approved = event.data.approved ? 'approved' : 'denied'
        log('success', `✓ Approval ${approved}: ${event.data.response_text || 'No comment'}`)
      } else if (event.type === 'session_status_changed') {
        const status = event.data.new_status || event.data.status || 'unknown'
        log('info', `Session status: ${status}`)

        // Exit when session completes or fails
        if (status === 'completed' || status === 'failed') {
          sessionCompleted = true
        }
      }
    })

    log('info', '\n📋 Session Information:')
    log('info', `Session ID: ${session.session_id}`)
    log('info', `Run ID: ${session.run_id}`)
    log('info', '\n🛠️  Manage approvals:')
    log('info', '  WUI: Open the HumanLayer desktop app')
    log('info', '\n📊 Monitoring MCP logs...')
    log('info', 'Press Ctrl+C to stop monitoring\n')

    // Keep running until session completes or interrupted
    await new Promise(resolve => {
      const sigintHandler = () => {
        log('info', '\nStopping monitor...')
        process.removeListener('SIGINT', sigintHandler)
        resolve(undefined)
      }
      process.on('SIGINT', sigintHandler)

      // Check periodically if session has completed
      const checkInterval = setInterval(() => {
        if (sessionCompleted) {
          clearInterval(checkInterval)
          process.removeListener('SIGINT', sigintHandler)
          log('info', '\n✨ Session completed, exiting...')
          resolve(undefined)
        }
      }, 100)
    })

    stopMonitoring()
  } finally {
    client.close()
    process.exit(0)
  }
}

// Main entry point
async function main() {
  // Parse command line arguments
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      test: {
        type: 'boolean',
        short: 't',
        default: false,
      },
      interactive: {
        type: 'boolean',
        short: 'i',
        default: false,
      },
      query: {
        type: 'string',
        short: 'q',
      },
    },
  })

  // Check if hlyr is built (we're in the hlyr/hack directory)
  const hlyrDistPath = join(__dirname, '..', 'dist', 'index.js')
  try {
    await fs.access(hlyrDistPath)
  } catch {
    log('error', 'hlyr is not built. Please run: cd .. && npm install && npm run build')
    process.exit(1)
  }

  // Ensure MCP log directory exists
  await fs.mkdir(MCP_LOG_DIR, { recursive: true })

  try {
    if (values.test) {
      await runAutomatedTest()
    } else if (values.interactive || !values.test) {
      await runInteractiveMode(values.query)
    }
  } catch (error) {
    log('error', `Error: ${error}`)
    process.exit(1)
  }
}

// Show usage if needed
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Local MCP Approvals Test Tool

Usage:
  bun test-local-approvals.ts [options]

Options:
  -t, --test         Run automated test (launches session, triggers approval, auto-approves)
  -i, --interactive  Run in interactive mode (launches session, monitors logs, manual approval)
  -q, --query        Custom query for the session (interactive mode only)
  -h, --help         Show this help message

Examples:
  # Run automated test
  bun test-local-approvals.ts --test

  # Interactive mode (default - will request to write to blah.txt)
  bun test-local-approvals.ts

  # Interactive mode with custom query
  bun test-local-approvals.ts -q "Help me analyze this codebase"

  # Interactive mode without triggering approval
  bun test-local-approvals.ts -q "Hello, how are you?"

Notes:
  - Run from the hlyr/hack directory
  - Make sure the daemon is running: cd ../../hld && ./dist/bin/hld -debug
  - Build hlyr first: cd .. && npm install && npm run build
  - In interactive mode, use TUI or WUI to approve/deny
  - MCP logs are saved to: ~/.humanlayer/logs/
`)
  process.exit(0)
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
