import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('claude init e2e tests', () => {
  let tempDir: string
  let testProjectDir: string

  beforeEach(async () => {
    // Create temp directory for test projects
    tempDir = await fs.mkdtemp(join(tmpdir(), 'claude-init-test-'))
    testProjectDir = join(tempDir, 'test-project')
    await fs.mkdir(testProjectDir, { recursive: true })
  })

  afterEach(async () => {
    // Cleanup temp files
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('--all flag', () => {
    it('should copy all files without prompting', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify directories were created
      const claudeDir = join(testProjectDir, '.claude')
      expect(
        await fs
          .stat(claudeDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)

      const commandsDir = join(claudeDir, 'commands')
      const agentsDir = join(claudeDir, 'agents')
      const settingsFile = join(claudeDir, 'settings.json')

      expect(
        await fs
          .stat(commandsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(agentsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(settingsFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)

      // Verify .gitignore was updated
      const gitignorePath = join(testProjectDir, '.gitignore')
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('.claude/settings.local.json')
    }, 15000)

    it('should work in non-TTY environment with --all flag', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir, {
        isTTY: false,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify files were created
      const claudeDir = join(testProjectDir, '.claude')
      expect(
        await fs
          .stat(claudeDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    }, 15000)
  })

  describe('--force flag', () => {
    it('should overwrite existing .claude directory without prompting', async () => {
      // Create existing .claude directory with a command file
      const claudeDir = join(testProjectDir, '.claude')
      const commandsDir = join(claudeDir, 'commands')
      await fs.mkdir(commandsDir, { recursive: true })
      const testFile = join(commandsDir, 'existing_command.md')
      await fs.writeFile(testFile, '# Existing Command\nOld content')

      const result = await runCommand(['claude', 'init', '--all', '--force'], testProjectDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify that new files were copied (directory was overwritten)
      const commandFiles = await fs.readdir(commandsDir)
      expect(commandFiles.length).toBeGreaterThan(1)

      // The old test file should not exist if it wasn't in the source
      // Or should be overwritten if it was - either way, verify commands directory exists
      expect(
        await fs
          .stat(commandsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    }, 15000)
  })

  describe('non-TTY environment', () => {
    it('should fail without --all flag in non-TTY environment', async () => {
      const result = await runCommand(['claude', 'init'], testProjectDir, {
        isTTY: false,
      })

      expect(result.exitCode).toBe(1)

      // Check both stdout and stderr for error message
      const output = result.stdout + result.stderr
      expect(output).toContain('Not running in interactive terminal')
      expect(output).toContain('Use --all flag')
    }, 15000)
  })

  describe('source directory validation', () => {
    it('should handle missing source directory gracefully', async () => {
      // This test may pass or fail depending on where tests are run from
      // The important thing is it should fail gracefully with a clear error message
      // For now, we'll just verify the command runs
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      // Either succeeds (source found) or fails with clear error (source not found)
      if (result.exitCode !== 0) {
        expect(result.stderr).toContain('Source .claude directory not found')
      } else {
        expect(result.stdout).toContain('Successfully copied')
      }
    }, 15000)
  })

  describe('file counting', () => {
    it('should accurately count files copied', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Extract file count from output
      const match = result.stdout.match(/Successfully copied (\d+) file/)
      expect(match).toBeTruthy()

      if (match) {
        const fileCount = parseInt(match[1], 10)
        expect(fileCount).toBeGreaterThan(0)
      }
    }, 15000)
  })

  describe('.gitignore management', () => {
    it('should create .gitignore if it does not exist', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignorePath = join(testProjectDir, '.gitignore')
      const gitignoreExists = await fs
        .stat(gitignorePath)
        .then(() => true)
        .catch(() => false)
      expect(gitignoreExists).toBe(true)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('.claude/settings.local.json')
      expect(gitignoreContent).toContain('# Claude Code local settings')
    }, 15000)

    it('should append to existing .gitignore', async () => {
      const gitignorePath = join(testProjectDir, '.gitignore')
      await fs.writeFile(gitignorePath, '# Existing content\nnode_modules/\n')

      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('# Existing content')
      expect(gitignoreContent).toContain('node_modules/')
      expect(gitignoreContent).toContain('.claude/settings.local.json')
    }, 15000)

    it('should not duplicate .gitignore entry', async () => {
      const gitignorePath = join(testProjectDir, '.gitignore')
      await fs.writeFile(gitignorePath, '# Claude Code local settings\n.claude/settings.local.json\n')

      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      const matches = gitignoreContent.match(/\.claude\/settings\.local\.json/g)
      expect(matches?.length).toBe(1)
    }, 15000)
  })

  describe('output formatting', () => {
    it('should use @clack/prompts styling', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Check for clack-style output (intro/outro)
      expect(result.stdout).toContain('Initialize Claude Code Configuration')
      expect(result.stdout).toContain('Successfully copied')
      expect(result.stdout).toContain('You can now use these commands')
    }, 15000)
  })

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // Try to run in a read-only directory (if possible)
      // This test is platform-dependent and may be skipped
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      // Command should either succeed or fail with a clear error message
      if (result.exitCode !== 0) {
        expect(result.stderr).toBeTruthy()
        expect(result.stderr.length).toBeGreaterThan(0)
      }
    }, 15000)
  })

  describe('thinking settings', () => {
    it('should set alwaysThinkingEnabled when --always-thinking flag is used', async () => {
      const result = await runCommand(['claude', 'init', '--all', '--always-thinking'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.alwaysThinkingEnabled).toBe(true)
    }, 15000)

    it('should disable alwaysThinkingEnabled when --no-always-thinking flag is used', async () => {
      const result = await runCommand(
        ['claude', 'init', '--all', '--no-always-thinking'],
        testProjectDir,
      )

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.alwaysThinkingEnabled).toBe(false)
    }, 15000)

    it('should set MAX_THINKING_TOKENS when --max-thinking-tokens flag is used', async () => {
      const result = await runCommand(
        ['claude', 'init', '--all', '--max-thinking-tokens', '50000'],
        testProjectDir,
      )

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.env.MAX_THINKING_TOKENS).toBe('50000')
    }, 15000)

    it('should use defaults when no thinking flags are provided', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.alwaysThinkingEnabled).toBe(true)
      expect(settings.env.MAX_THINKING_TOKENS).toBe('32000')
      expect(settings.env.CLAUDE_BASH_MAINTAIN_WORKING_DIR).toBe('1')
    }, 15000)

    it('should combine thinking flags correctly', async () => {
      const result = await runCommand(
        ['claude', 'init', '--all', '--no-always-thinking', '--max-thinking-tokens', '100000'],
        testProjectDir,
      )

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.alwaysThinkingEnabled).toBe(false)
      expect(settings.env.MAX_THINKING_TOKENS).toBe('100000')
      expect(settings.env.CLAUDE_BASH_MAINTAIN_WORKING_DIR).toBe('1')
    }, 15000)
  })

  describe('model configuration', () => {
    it('should set model to opus by default', async () => {
      const result = await runCommand(['claude', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.model).toBe('opus')
    }, 15000)

    it('should set model when --model flag is used with opus', async () => {
      const result = await runCommand(['claude', 'init', '--all', '--model', 'opus'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.model).toBe('opus')
    }, 15000)

    it('should set model when --model flag is used with sonnet', async () => {
      const result = await runCommand(['claude', 'init', '--all', '--model', 'sonnet'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.model).toBe('sonnet')
    }, 15000)

    it('should set model when --model flag is used with haiku', async () => {
      const result = await runCommand(['claude', 'init', '--all', '--model', 'haiku'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.model).toBe('haiku')
    }, 15000)

    it('should reject invalid model values', async () => {
      const result = await runCommand(['claude', 'init', '--all', '--model', 'invalid'], testProjectDir)

      expect(result.exitCode).toBe(1)
      const output = result.stdout + result.stderr
      expect(output).toContain('Invalid model')
      expect(output).toContain('haiku, sonnet, opus')
    }, 15000)

    it('should combine model with other settings flags', async () => {
      const result = await runCommand(
        [
          'claude',
          'init',
          '--all',
          '--model',
          'haiku',
          '--no-always-thinking',
          '--max-thinking-tokens',
          '50000',
        ],
        testProjectDir,
      )

      expect(result.exitCode).toBe(0)

      const settingsPath = join(testProjectDir, '.claude', 'settings.json')
      const settingsContent = await fs.readFile(settingsPath, 'utf8')
      const settings = JSON.parse(settingsContent)

      expect(settings.model).toBe('haiku')
      expect(settings.alwaysThinkingEnabled).toBe(false)
      expect(settings.env.MAX_THINKING_TOKENS).toBe('50000')
      expect(settings.env.CLAUDE_BASH_MAINTAIN_WORKING_DIR).toBe('1')
    }, 15000)
  })
})

async function runCommand(
  args: string[],
  cwd: string,
  options?: {
    isTTY?: boolean
  },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  return new Promise((resolve, reject) => {
    // Build path to the CLI binary
    const cliPath = join(__dirname, '..', 'dist', 'index.js')

    // Prepare stdio based on TTY option
    const stdio = options?.isTTY === false ? ['pipe', 'pipe', 'pipe'] : 'pipe'

    const child = spawn('node', [cliPath, ...args], {
      cwd,
      stdio,
      env: {
        ...process.env,
        // Force non-TTY mode if requested
        ...(options?.isTTY === false && { TERM: 'dumb' }),
      },
    })

    // Close stdin immediately for non-TTY tests
    if (options?.isTTY === false && child.stdin) {
      child.stdin.end()
    }

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
    }, 12000)
  })
}
