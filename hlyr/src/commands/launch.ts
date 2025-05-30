import { resolveFullConfig } from '../config.js'
import { connect } from 'net'
import { homedir } from 'os'
import { join } from 'path'

interface LaunchOptions {
  prompt?: string
  model?: string
  workingDir?: string
  maxTurns?: number
  daemonSocket?: string
  configFile?: string
  approvals?: boolean
}

// Simple JSON-RPC client for launching sessions
async function launchSession(socketPath: string, prompt: string, options: LaunchOptions = {}) {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath, () => {
      // Build MCP config (approvals enabled by default unless explicitly disabled)
      const mcpConfig = options.approvals !== false ? {
        mcpServers: {
          approvals: {
            command: 'npx',
            args: ['humanlayer', 'mcp', 'claude_approvals']
          }
        }
      } : undefined
      
      const request = {
        jsonrpc: '2.0',
        method: 'launchSession',
        params: {
          prompt: prompt,
          model: options.model,
          working_dir: options.workingDir || process.cwd(),
          max_turns: options.maxTurns,
          mcp_config: mcpConfig,
          permission_prompt_tool: mcpConfig ? 'mcp__approvals__request_permission' : undefined,
        },
        id: 1
      }
      
      client.write(JSON.stringify(request) + '\n')
    })
    
    let buffer = ''
    client.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line)
            client.end()
            
            if (response.error) {
              reject(new Error(`RPC Error: ${response.error.message}`))
            } else {
              resolve(response.result)
            }
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err}`))
          }
        }
      }
    })
    
    client.on('error', (err) => {
      reject(new Error(`Connection failed: ${err.message}`))
    })
  })
}

export const launchCommand = async (prompt: string, options: LaunchOptions = {}) => {
  try {
    // Get socket path from configuration
    const config = resolveFullConfig(options)
    let socketPath = config.daemon_socket
    
    // Expand ~ to home directory if needed
    if (socketPath.startsWith('~')) {
      socketPath = join(homedir(), socketPath.slice(1))
    }
    
    console.log('Launching Claude Code session...')
    console.log('Prompt:', prompt)
    if (options.model) console.log('Model:', options.model)
    console.log('Working directory:', options.workingDir || process.cwd())
    console.log('Approvals enabled:', options.approvals !== false)
    
    const result = await launchSession(socketPath, prompt, options) as any
    
    console.log('\nSession launched successfully!')
    console.log('Session ID:', result.session_id)
    console.log('Run ID:', result.run_id)
    console.log('\nYou can now use "npx humanlayer tui" to manage approvals for this session.')
  } catch (error) {
    console.error('Failed to launch session:', error)
    console.error('\nMake sure the daemon is running. You can start it with:')
    console.error('  hld')
    process.exit(1)
  }
}