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
    api_key?: string
    api_base_url: string
    app_base_url: string
    contact_channel: Record<string, unknown>
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
        api_base_url: 'https://api.humanlayer.dev/humanlayer/v1',
        app_base_url: 'https://app.humanlayer.dev',
        contact_channel: {},
      },
    },
    {
      name: 'slack channel flag override',
      flags: ['--slack-channel', 'C123456'],
      expected: {
        api_base_url: 'https://api.humanlayer.dev/humanlayer/v1',
        app_base_url: 'https://app.humanlayer.dev',
        contact_channel: {
          slack: {
            channel_or_user_id: 'C123456',
            experimental_slack_blocks: true,
          },
        },
      },
    },
    {
      name: 'environment variables',
      env: {
        HUMANLAYER_API_KEY: 'test-token-123456',
        HUMANLAYER_API_BASE: 'https://api.example.com',
        HUMANLAYER_APP_URL: 'https://app.example.com',
        HUMANLAYER_SLACK_CHANNEL: 'C789012',
        HUMANLAYER_SLACK_BOT_TOKEN: 'xoxb-test-bot-token',
      },
      expected: {
        api_key: 'test-t...',
        api_base_url: 'https://api.example.com',
        app_base_url: 'https://app.example.com',
        contact_channel: {
          slack: {
            channel_or_user_id: 'C789012',
            experimental_slack_blocks: true,
            bot_token: 'xoxb-t...',
          },
        },
      },
    },
    {
      name: 'email configuration via env',
      env: {
        HUMANLAYER_EMAIL_ADDRESS: 'test@example.com',
        HUMANLAYER_EMAIL_CONTEXT: 'Support team',
      },
      expected: {
        api_base_url: 'https://api.humanlayer.dev/humanlayer/v1',
        app_base_url: 'https://app.humanlayer.dev',
        contact_channel: {
          email: {
            address: 'test@example.com',
            context_about_user: 'Support team',
          },
        },
      },
    },
    {
      name: 'flags override environment variables',
      env: {
        HUMANLAYER_SLACK_CHANNEL: 'C111111',
        HUMANLAYER_EMAIL_ADDRESS: 'env@example.com',
      },
      flags: ['--slack-channel', 'C222222', '--email-address', 'flag@example.com'],
      expected: {
        api_base_url: 'https://api.humanlayer.dev/humanlayer/v1',
        app_base_url: 'https://app.humanlayer.dev',
        contact_channel: {
          slack: {
            channel_or_user_id: 'C222222',
            experimental_slack_blocks: true,
          },
          email: {
            address: 'flag@example.com',
          },
        },
      },
    },
    {
      name: 'config file with API settings',
      configFile: {
        content: {
          api_key: 'config-token-123456',
          api_base_url: 'https://config-api.example.com',
          app_base_url: 'https://config-app.example.com',
          channel: {
            slack: {
              channel_or_user_id: 'C333333',
              bot_token: 'config-bot-token-123456',
              context_about_channel_or_user: 'Config team',
              experimental_slack_blocks: false,
            },
          },
        },
      },
      expected: {
        api_key: 'config...',
        api_base_url: 'https://config-api.example.com',
        app_base_url: 'https://config-app.example.com',
        contact_channel: {
          slack: {
            channel_or_user_id: 'C333333',
            bot_token: 'config...',
            context_about_channel_or_user: 'Config team',
            experimental_slack_blocks: true,
          },
        },
      },
    },
    {
      name: 'mixed channels from different sources',
      env: {
        HUMANLAYER_EMAIL_ADDRESS: 'env@example.com',
      },
      flags: ['--slack-channel', 'C444444', '--slack-context', 'Flag context'],
      expected: {
        api_base_url: 'https://api.humanlayer.dev/humanlayer/v1',
        app_base_url: 'https://app.humanlayer.dev',
        contact_channel: {
          slack: {
            channel_or_user_id: 'C444444',
            context_about_channel_or_user: 'Flag context',
            experimental_slack_blocks: true,
          },
          email: {
            address: 'env@example.com',
          },
        },
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
      if (testCase.flags) {
        args.push(...testCase.flags)
      }
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
        HUMANLAYER_SLACK_CHANNEL: 'C123456',
      },
      tempDir,
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('HumanLayer Configuration')
    expect(result.stdout).toContain('Config File Sources:')
    expect(result.stdout).toContain('API Configuration:')
    expect(result.stdout).toContain('Contact Channel Configuration:')
    expect(result.stdout).toContain('C123456')
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
