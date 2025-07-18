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

    // Connect to daemon
    const client = await connectWithRetry(socketPath, 3, 1000)

    try {
      // Build MCP config (approvals enabled by default unless explicitly disabled)
      // For development, use the local built version directly
      const scriptPath = new URL(import.meta.url).pathname
      const projectRoot = scriptPath.split('/hlyr/')[0] + '/hlyr'
      const localHlyrPath = `${projectRoot}/dist/index.js`
      
      const mcpConfig =
        options.approvals !== false
          ? {
              mcpServers: {
                approvals: {
                  command: 'node',
                  args: [localHlyrPath, 'mcp', 'claude_approvals'],
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
        permission_prompt_tool: mcpConfig ? 'mcp__approvals__request_permission' : undefined,
      })

      console.log('\nSession launched successfully!')
      console.log('Session ID:', result.session_id)
      console.log('Run ID:', result.run_id)
      console.log('\nYou can now use "npx humanlayer tui" to manage approvals for this session.')
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
