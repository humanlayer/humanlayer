import chalk from 'chalk'
import { DaemonClient, connectWithRetry } from '../daemonClient.js'
import { resolveFullConfig } from '../config.js'
import playSound from 'play-sound'
import { homedir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'

// Re-export the Event interface from daemonClient
interface Event {
  type: 'new_approval' | 'approval_resolved' | 'session_status_changed'
  timestamp: string
  data: EventData
}

interface AlertOptions {
  daemonSocket?: string
  eventTypes?: string[]
  sessionId?: string
  runId?: string
  soundFile?: string
  quiet?: boolean
}

const player = playSound()

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

interface EventData {
  type?: 'function_call' | 'human_contact'
  count?: number
  session_id?: string
  run_id?: string
  function_name?: string
  message?: string
  [key: string]: string | number | boolean | undefined
}

function formatEventData(data: EventData): string {
  const parts: string[] = []

  if (data.type) {
    parts.push(`type: ${chalk.cyan(String(data.type))}`)
  }

  if (data.function_name) {
    parts.push(`function: ${chalk.yellow(String(data.function_name))}`)
  }

  if (data.message) {
    parts.push(`message: ${chalk.white(String(data.message))}`)
  }

  if (data.count !== undefined) {
    parts.push(`count: ${chalk.magenta(String(data.count))}`)
  }

  if (data.session_id) {
    parts.push(`session: ${chalk.gray(String(data.session_id).substring(0, 8))}`)
  }

  return parts.join(', ')
}

async function playAlertSound(soundFile?: string): Promise<void> {
  return new Promise(resolve => {
    // Default to system beep
    if (!soundFile) {
      // Try to play a simple beep sound
      // On macOS, we can use the system sound
      if (process.platform === 'darwin') {
        player.play('/System/Library/Sounds/Glass.aiff', err => {
          if (err) console.error('Failed to play sound:', err.message)
          resolve()
        })
      } else {
        // For other platforms, just print a bell character
        process.stdout.write('\u0007')
        resolve()
      }
    } else {
      // Play custom sound file
      player.play(soundFile, err => {
        if (err) console.error('Failed to play sound file:', err.message)
        resolve()
      })
    }
  })
}

export async function alertCommand(options: AlertOptions = {}): Promise<void> {
  const config = resolveFullConfig(options)

  let socketPath = options.daemonSocket || config.daemon_socket

  // Expand ~ to home directory if needed
  if (socketPath.startsWith('~')) {
    socketPath = join(homedir(), socketPath.slice(1))
  }

  console.log(chalk.blue('🔔 Starting HumanLayer alert monitor...'))
  console.log(chalk.gray('Press Ctrl+C to stop'))
  console.log()

  // Set up event type filter
  const eventTypes = options.eventTypes || ['new_approval']
  console.log(chalk.gray(`Watching for events: ${eventTypes.join(', ')}`))

  if (options.sessionId) {
    console.log(chalk.gray(`Filtering by session: ${options.sessionId}`))
  }

  if (options.runId) {
    console.log(chalk.gray(`Filtering by run: ${options.runId}`))
  }

  console.log()

  let client: DaemonClient | undefined
  let subscriptionEmitter: EventEmitter | undefined

  // Handle cleanup on exit
  const cleanup = () => {
    console.log(chalk.yellow('\nStopping alert monitor...'))
    if (client) client.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    // Connect to daemon with retries
    console.log(chalk.gray('Connecting to daemon...'))
    client = await connectWithRetry(socketPath, 3, 1000)
    console.log(chalk.green('✓ Connected to daemon'))

    // Subscribe to events
    console.log(chalk.gray('Subscribing to events...'))
    subscriptionEmitter = await client.subscribe({
      event_types: eventTypes,
      session_id: options.sessionId,
      run_id: options.runId,
    })

    console.log(chalk.green('✓ Subscribed successfully'))
    console.log(chalk.blue('\n👂 Listening for events...\n'))

    // Set up event handler
    subscriptionEmitter.on('event', async (event: Event) => {
      const timestamp = formatTimestamp(event.timestamp)
      const emoji =
        event.type === 'new_approval' ? '🆕' : event.type === 'approval_resolved' ? '✅' : '📌'

      console.log(
        `[${chalk.gray(timestamp)}] ${emoji} ${chalk.bold(event.type)}: ${formatEventData(event.data)}`,
      )

      // Play sound for new approvals
      if (event.type === 'new_approval' && !options.quiet) {
        await playAlertSound(options.soundFile)
      }
    })

    // Handle connection close
    subscriptionEmitter.on('close', () => {
      console.error(chalk.red('\n✗ Lost connection to daemon'))
      process.exit(1)
    })

    // Handle errors
    subscriptionEmitter.on('error', (err: Error) => {
      console.error(chalk.red(`\n✗ Error: ${err.message}`))
    })

    // Keep the process alive
    process.stdin.resume()
  } catch (error) {
    console.error(chalk.red('✗ Failed to start alert monitor'))
    console.error(chalk.red(`Error: ${error}`))

    // Check if daemon is running
    console.error(chalk.gray('\nMake sure the HumanLayer daemon is running'))

    process.exit(1)
  }
}
