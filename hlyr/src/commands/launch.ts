import { connectWithRetry } from '../daemonClient.js'
import { resolveFullConfig } from '../config.js'
import { homedir } from 'os'
import { join } from 'path'

interface LaunchOptions {
  query?: string
  model?: string
  workingDir?: string
  maxTurns?: number
  daemonSocket?: string
  configFile?: string
  approvals?: boolean
  dangerouslySkipPermissions?: boolean
  dangerouslySkipPermissionsTimeout?: string
}

export const launchCommand = async (query: string, options: LaunchOptions = {}) => {
  try {
    // Get socket path from configuration
    const config = resolveFullConfig(options)
    let socketPath = config.daemon_socket

    // Expand ~ to home directory if needed
    if (socketPath.startsWith('~')) {
      socketPath = join(homedir(), socketPath.slice(1))
    }

    console.log('Launching Claude Code session...')
    console.log('Query:', query)
    if (options.model) console.log('Model:', options.model)
    console.log('Working directory:', options.workingDir || process.cwd())
    console.log('Approvals enabled:', options.approvals !== false)

    if (options.dangerouslySkipPermissions) {
      console.log('⚠️  Dangerously skip permissions enabled - ALL tools will be auto-approved')
      if (options.dangerouslySkipPermissionsTimeout) {
        console.log(`   Auto-disabling after ${options.dangerouslySkipPermissionsTimeout} minutes`)
      }
    }

    // Connect to daemon
    const client = await connectWithRetry(socketPath, 3, 1000)

    try {
      // Build MCP config (approvals enabled by default unless explicitly disabled)
      // Phase 6: Using HTTP MCP endpoint instead of stdio
      const daemonPort = process.env.HUMANLAYER_DAEMON_HTTP_PORT || '7777'
      const mcpConfig =
        options.approvals !== false
          ? {
              mcpServers: {
                codelayer: {
                  type: 'http',
                  url: `http://localhost:${daemonPort}/api/v1/mcp`,
                  // Session ID will be added as header by Claude Code
                },
              },
            }
          : undefined

      // Launch the session
      const result = await client.launchSession({
        query: query,
        model: options.model,
        working_dir: options.workingDir || process.cwd(),
        max_turns: options.maxTurns,
        mcp_config: mcpConfig,
        permission_prompt_tool: mcpConfig ? 'mcp__codelayer__request_approval' : undefined,
        dangerously_skip_permissions: options.dangerouslySkipPermissions,
        dangerously_skip_permissions_timeout: options.dangerouslySkipPermissionsTimeout
          ? parseInt(options.dangerouslySkipPermissionsTimeout) * 60 * 1000
          : undefined,
      })

      console.log('\nSession launched successfully!')
      console.log('Session ID:', result.session_id)
      console.log('Run ID:', result.run_id)
      console.log('\nYou can now use CodeLayer manage this session.')
    } finally {
      // Close the client connection
      client.close()
    }
  } catch (error) {
    console.error('Failed to launch session:', error)
    console.error('\nMake sure the daemon is running. You can start it with:')
    console.error('  npx humanlayer tui')
    process.exit(1)
  }
}
