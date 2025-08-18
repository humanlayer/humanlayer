import { connectWithRetry } from '../daemonHttpClient.js'
import { resolveFullConfig } from '../config.js'

interface LaunchOptions {
  query?: string
  title?: string
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
    // Get daemon HTTP URL from configuration or environment
    const config = resolveFullConfig(options)
    const daemonPort = process.env.HUMANLAYER_DAEMON_HTTP_PORT || config.daemon_http_port || '7777'
    const daemonURL = process.env.HUMANLAYER_DAEMON_URL || `http://localhost:${daemonPort}`

    console.log('Launching Claude Code session...')
    console.log('Query:', query)
    if (options.title) console.log('Title:', options.title)
    if (options.model) console.log('Model:', options.model)
    console.log('Working directory:', options.workingDir || process.cwd())
    console.log('Approvals enabled:', options.approvals !== false)

    if (options.dangerouslySkipPermissions) {
      console.log('⚠️  Dangerously skip permissions enabled - ALL tools will be auto-approved')
      if (options.dangerouslySkipPermissionsTimeout) {
        console.log(`   Auto-disabling after ${options.dangerouslySkipPermissionsTimeout} minutes`)
      }
    }

    // Connect to daemon via HTTP
    const client = await connectWithRetry(daemonURL, 3, 1000)

    try {
      // Build MCP config (approvals enabled by default unless explicitly disabled)
      // Phase 6: Using HTTP MCP endpoint instead of stdio
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
        title: options.title,
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
