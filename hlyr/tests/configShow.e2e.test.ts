import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

interface TestCase {
  name: string
  env?: Record<string, string>
  flags?: string[]
  configFile?: {
    content: Record<string, unknown>
    path?: string
  }
  expected: {
    www_base_url: string
    daemon_socket: string
    run_id?: string
  }
}

describe('config show e2e tests', () => {
  let tempDir: string
  let originalEnv: Record<string, string | undefined>

  beforeEach(async () => {
    // Create temp directory for test config files
    tempDir = await fs.mkdtemp(join(tmpdir(), 'hlyr-test-'))

    // Save original env
    originalEnv = { ...process.env }

    // Clear all HUMANLAYER_* env vars
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('HUMANLAYER_')) {
        delete process.env[key]
      }
    })
  })

  afterEach(async () => {
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('HUMANLAYER_')) {
        delete process.env[key]
      }
    })
    Object.assign(process.env, originalEnv)

    // Cleanup temp files
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  const testCases: TestCase[] = [
    {
      name: 'default config with no env or flags',
      expected: {
        www_base_url: 'https://www.humanlayer.dev',
        daemon_socket: '~/.humanlayer/daemon.sock',
      },
    },
    {
      name: 'environment variables override defaults',
      env: {
        HUMANLAYER_WWW_BASE_URL: 'https://www.example.com',
        HUMANLAYER_DAEMON_SOCKET: '~/.humanlayer/custom.sock',
        HUMANLAYER_RUN_ID: 'test-run-123',
      },
      expected: {
        www_base_url: 'https://www.example.com',
        daemon_socket: '~/.humanlayer/custom.sock',
        run_id: 'test-run-123',
      },
    },
    {
      name: 'config file overrides defaults',
      configFile: {
        content: {
          www_base_url: 'https://config.example.com',
          daemon_socket: '~/.humanlayer/config.sock',
        },
      },
      expected: {
        www_base_url: 'https://config.example.com',
        daemon_socket: '~/.humanlayer/config.sock',
      },
    },
    {
      name: 'environment variables override config file',
      env: {
        HUMANLAYER_WWW_BASE_URL: 'https://env.example.com',
      },
      configFile: {
        content: {
          www_base_url: 'https://config.example.com',
          daemon_socket: '~/.humanlayer/config.sock',
        },
      },
      expected: {
        www_base_url: 'https://env.example.com',
        daemon_socket: '~/.humanlayer/config.sock',
      },
    },
  ]

  testCases.forEach(testCase => {
    it(`should handle ${testCase.name}`, async () => {
      let configFilePath: string | undefined

      // Create config file if specified
      if (testCase.configFile) {
        configFilePath = testCase.configFile.path || join(tempDir, 'test-config.json')
        await fs.writeFile(configFilePath, JSON.stringify(testCase.configFile.content, null, 2))
      }

      // Set up environment variables
      if (testCase.env) {
        Object.assign(process.env, testCase.env)
      }

      // Build command args
      const args = ['config', 'show', '--json']
      if (configFilePath) {
        args.push('--config-file', configFilePath)
      }

      // Execute command
      const result = await runCommand(args, testCase.env, tempDir)

      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)

      const output = JSON.parse(result.stdout)

      // Validate expected output
      expect(output).toEqual(testCase.expected)
    }, 10000) // 10 second timeout for process spawning
  })

  it('should show human-readable output without --json flag', async () => {
    const result = await runCommand(
      ['config', 'show'],
      {
        HUMANLAYER_WWW_BASE_URL: 'https://www.example.com',
      },
      tempDir,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('HumanLayer Configuration')
    expect(result.stdout).toContain('Config File Sources:')
    expect(result.stdout).toContain('Configuration:')
    expect(result.stdout).toContain('WWW Base URL')
    expect(result.stdout).toContain('Daemon Socket')
  })
})

async function runCommand(
  args: string[],
  env?: Record<string, string>,
  cwd?: string,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  return new Promise((resolve, reject) => {
    // Build path to the CLI binary
    const cliPath = join(__dirname, '..', 'dist', 'index.js')

    // Create isolated environment that prevents reading actual config files
    const isolatedEnv = {
      // Remove all HUMANLAYER_ env vars that might leak from the real environment
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('HUMANLAYER_')),
      ),
      // Set HOME to temp directory to isolate XDG_CONFIG_HOME
      HOME: cwd || process.env.TMPDIR || '/tmp',
      // Clear XDG_CONFIG_HOME to use HOME/.config
      XDG_CONFIG_HOME: undefined,
      // Add test-specific env vars
      ...env,
    }

    const child = spawn('node', [cliPath, ...args], {
      env: isolatedEnv,
      cwd: cwd || process.env.TMPDIR || '/tmp',
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', data => {
      stdout += data.toString()
    })

    child.stderr?.on('data', data => {
      stderr += data.toString()
    })

    child.on('close', code => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
      })
    })

    child.on('error', error => {
      reject(error)
    })

    // Set timeout
    setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Command timeout'))
    }, 8000)
  })
}
