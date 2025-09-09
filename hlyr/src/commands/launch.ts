import { connectWithRetry } from '../daemonClient.js'
import { resolveFullConfig } from '../config.js'
import { homedir } from 'os'
import { join } from 'path'

interface LaunchOptions {
  query?: string
  title?: string
  model?: string
  workingDir?: string
  additionalDirectories?: string[]
  addDir?: string[] // CLI option name maps to this
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

    // Handle additional directories from either option name
    const additionalDirs = options.additionalDirectories || options.addDir || []

    console.log('Launching Claude Code session...')
    console.log('Query:', query)
    if (options.title) console.log('Title:', options.title)
    if (options.model) console.log('Model:', options.model)
    console.log('Working directory:', options.workingDir || process.cwd())
    if (additionalDirs.length > 0) {
      console.log('Additional directories:', additionalDirs)
    }
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
      // Launch the session
      const result = await client.launchSession({
        query: query,
        title: options.title,
        model: options.model,
        working_dir: options.workingDir || process.cwd(),
        additional_directories: additionalDirs,
        max_turns: options.maxTurns,
        // MCP config is now injected by daemon
        permission_prompt_tool:
          options.approvals !== false ? 'mcp__codelayer__request_permission' : undefined,
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
