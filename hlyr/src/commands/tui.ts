import { spawn } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { connect } from 'net'
import { resolveFullConfig } from '../config.js'

// Check if the daemon is running by trying to connect to its socket
async function isDaemonRunning(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const client = connect(socketPath, () => {
      client.end()
      resolve(true)
    })

    client.on('error', () => {
      resolve(false)
    })

    // Set a timeout
    client.setTimeout(1000, () => {
      client.destroy()
      resolve(false)
    })
  })
}

// Start the daemon in the background
async function startDaemon(daemonPath: string, config: any): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('Starting HumanLayer daemon...')

    // Pass configuration via environment variables
    const env = { ...process.env }
    if (config.api_key) {
      env.HUMANLAYER_API_KEY = config.api_key
    }
    if (config.api_base_url) {
      env.HUMANLAYER_API_BASE_URL = config.api_base_url
    }

    const daemon = spawn(daemonPath, [], {
      detached: true,
      stdio: 'ignore',
      env,
    })

    daemon.on('error', err => {
      reject(new Error(`Failed to start daemon: ${err.message}`))
    })

    daemon.on('spawn', () => {
      // Daemon started successfully
      daemon.unref() // Allow parent to exit independently

      // Give the daemon a moment to initialize
      setTimeout(() => {
        console.log('Daemon started successfully')
        resolve()
      }, 2000)
    })
  })
}

export const tuiCommand = async (options: Record<string, unknown> = {}) => {
  let child: ReturnType<typeof spawn> | null = null

  try {
    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    // Get socket path from configuration
    const config = resolveFullConfig(options)
    let socketPath = config.daemon_socket

    // Expand ~ to home directory if needed
    if (socketPath.startsWith('~')) {
      socketPath = join(homedir(), socketPath.slice(1))
    }

    // Check if daemon is running
    const daemonRunning = await isDaemonRunning(socketPath)

    if (!daemonRunning) {
      // Look for daemon binary
      const daemonPath = join(__dirname, './bin/hld')

      if (!existsSync(daemonPath)) {
        console.error('Daemon binary not found at:', daemonPath)
        console.error('Please ensure the HumanLayer daemon is installed.')
        process.exit(1)
      }

      try {
        await startDaemon(daemonPath, config)
      } catch (err) {
        console.error('Failed to start daemon:', err)
        console.error('You can try starting it manually with: hld')
        process.exit(1)
      }
    }

    // Path to the Go binary in dist/bin
    const binaryPath = join(__dirname, './bin/humanlayer-tui')

    // Prepare environment with daemon socket path if needed
    const env = { ...process.env }
    if (socketPath !== join(homedir(), '.humanlayer', 'daemon.sock')) {
      env.HUMANLAYER_DAEMON_SOCKET = socketPath
    }

    // Spawn the Go binary
    child = spawn(binaryPath, [], { stdio: 'inherit', env })

    // Handle child process exit
    child.on('exit', code => process.exit(code ?? 0))
    child.on('error', err => {
      console.error('Failed to start the TUI binary:', err)
      process.exit(1)
    })

    // Handle termination signals
    const handleSignal = (signal: NodeJS.Signals) => {
      if (child) {
        // Send the same signal to the child process
        child.kill(signal)
      }
    }

    // Register signal handlers
    process.on('SIGINT', handleSignal) // Ctrl+C
    process.on('SIGTERM', handleSignal) // kill command
    process.on('SIGHUP', handleSignal) // terminal closed

    // Cleanup on parent process exit
    process.on('exit', () => {
      if (child) {
        child.kill()
      }
    })
  } catch (error) {
    console.error('Error running tui:', error)
    if (child) {
      child.kill()
    }
    process.exit(1)
  }
}
