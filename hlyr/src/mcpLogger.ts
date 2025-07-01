import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

interface LogEntry {
  timestamp: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  component: string
  message: string
  data?: unknown
}

class MCPLogger {
  private logDir: string
  private logPath: string
  private isDebug: boolean
  private writeStream?: fs.WriteStream

  constructor() {
    // Check if debug mode is enabled
    this.isDebug = process.env.HUMANLAYER_MCP_DEBUG === 'true'

    // Create log directory
    this.logDir = path.join(os.homedir(), '.humanlayer', 'logs')
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true })
    }

    // Create log file with run ID if available, otherwise use date
    const runId = process.env.HUMANLAYER_RUN_ID
    const identifier = runId || new Date().toISOString().split('T')[0]
    this.logPath = path.join(this.logDir, `mcp-claude-approvals-${identifier}.log`)

    // Open write stream in append mode
    this.writeStream = fs.createWriteStream(this.logPath, { flags: 'a' })

    // Log startup
    this.info('MCP Logger initialized', {
      logPath: this.logPath,
      debug: this.isDebug,
      runId: process.env.HUMANLAYER_RUN_ID,
    })
  }

  private write(entry: LogEntry): void {
    if (!this.writeStream) return

    const line = JSON.stringify(entry) + '\n'
    this.writeStream.write(line)
  }

  private shouldLog(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'): boolean {
    // Always log warnings and errors
    if (level === 'WARN' || level === 'ERROR') return true

    // Only log debug/info if debug mode is enabled
    return this.isDebug
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog('DEBUG')) return

    this.write({
      timestamp: new Date().toISOString(),
      level: 'DEBUG',
      component: 'mcp-claude-approvals',
      message,
      data,
    })
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog('INFO')) return

    this.write({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      component: 'mcp-claude-approvals',
      message,
      data,
    })
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog('WARN')) return

    this.write({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      component: 'mcp-claude-approvals',
      message,
      data,
    })
  }

  error(message: string, error?: unknown): void {
    if (!this.shouldLog('ERROR')) return

    let errorData: unknown = error
    if (error instanceof Error) {
      errorData = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    this.write({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      component: 'mcp-claude-approvals',
      message,
      data: errorData,
    })
  }

  close(): void {
    if (this.writeStream) {
      this.writeStream.end()
      this.writeStream = undefined
    }
  }
}

// Export singleton instance
export const logger = new MCPLogger()

// Handle process exit
process.on('exit', () => {
  logger.close()
})

process.on('SIGINT', () => {
  logger.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  logger.close()
  process.exit(0)
})
