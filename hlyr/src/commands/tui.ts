import { spawn } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

export const tuiCommand = async () => {
  let child: ReturnType<typeof spawn> | null = null

  try {
    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    // Path to the Go binary in dist/bin
    const binaryPath = join(__dirname, './bin/humanlayer-tui')

    // Spawn the Go binary
    child = spawn(binaryPath, [], { stdio: 'inherit' })

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
