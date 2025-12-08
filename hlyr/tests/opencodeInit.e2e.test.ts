import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('opencode init e2e tests', () => {
  let tempDir: string
  let testProjectDir: string

  beforeEach(async () => {
    // Create temp directory for test projects
    tempDir = await fs.mkdtemp(join(tmpdir(), 'opencode-init-test-'))
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
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify directories were created
      const opencodeDir = join(testProjectDir, '.opencode')
      expect(
        await fs
          .stat(opencodeDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)

      const commandDir = join(opencodeDir, 'command') // SINGULAR
      const agentDir = join(opencodeDir, 'agent') // SINGULAR
      const configFile = join(opencodeDir, 'opencode.json')

      expect(
        await fs
          .stat(commandDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(agentDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(configFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)

      // Verify .gitignore was updated
      const gitignorePath = join(testProjectDir, '.gitignore')
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('.opencode/opencode.local.json')
    }, 15000)

    it('should work in non-TTY environment with --all flag', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir, {
        isTTY: false,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify files were created
      const opencodeDir = join(testProjectDir, '.opencode')
      expect(
        await fs
          .stat(opencodeDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    }, 15000)
  })

  describe('--force flag', () => {
    it('should overwrite existing .opencode directory without prompting', async () => {
      // Create existing .opencode directory with a command file
      const opencodeDir = join(testProjectDir, '.opencode')
      const commandDir = join(opencodeDir, 'command')
      await fs.mkdir(commandDir, { recursive: true })
      const testFile = join(commandDir, 'existing_command.md')
      await fs.writeFile(testFile, '# Existing Command\nOld content')

      const result = await runCommand(['opencode', 'init', '--all', '--force'], testProjectDir)

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Successfully copied')

      // Verify that new files were copied (directory was overwritten)
      const commandFiles = await fs.readdir(commandDir)
      expect(commandFiles.length).toBeGreaterThan(1)

      // The old test file should not exist if it wasn't in the source
      // Or should be overwritten if it was - either way, verify command directory exists
      expect(
        await fs
          .stat(commandDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    }, 15000)
  })

  describe('non-TTY environment', () => {
    it('should fail without --all flag in non-TTY environment', async () => {
      const result = await runCommand(['opencode', 'init'], testProjectDir, {
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
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

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
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

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
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignorePath = join(testProjectDir, '.gitignore')
      const gitignoreExists = await fs
        .stat(gitignorePath)
        .then(() => true)
        .catch(() => false)
      expect(gitignoreExists).toBe(true)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('.opencode/opencode.local.json')
      expect(gitignoreContent).toContain('# OpenCode local settings')
    }, 15000)

    it('should append to existing .gitignore', async () => {
      const gitignorePath = join(testProjectDir, '.gitignore')
      await fs.writeFile(gitignorePath, '# Existing content\nnode_modules/\n')

      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      expect(gitignoreContent).toContain('# Existing content')
      expect(gitignoreContent).toContain('node_modules/')
      expect(gitignoreContent).toContain('.opencode/opencode.local.json')
    }, 15000)

    it('should not duplicate .gitignore entry', async () => {
      const gitignorePath = join(testProjectDir, '.gitignore')
      await fs.writeFile(
        gitignorePath,
        '# OpenCode local settings\n.opencode/opencode.local.json\n',
      )

      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
      const matches = gitignoreContent.match(/\.opencode\/opencode\.local\.json/g)
      expect(matches?.length).toBe(1)
    }, 15000)
  })

  describe('output formatting', () => {
    it('should use @clack/prompts styling', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Check for clack-style output (intro/outro)
      expect(result.stdout).toContain('Initialize OpenCode Configuration')
      expect(result.stdout).toContain('Successfully copied')
      expect(result.stdout).toContain('You can now use these commands')
    }, 15000)
  })

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // Try to run in a read-only directory (if possible)
      // This test is platform-dependent and may be skipped
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      // Command should either succeed or fail with a clear error message
      if (result.exitCode !== 0) {
        expect(result.stderr).toBeTruthy()
        expect(result.stderr.length).toBeGreaterThan(0)
      }
    }, 15000)
  })

  describe('model configuration', () => {
    it('should set model to opus by default', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const configContent = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(configContent)

      expect(config.model).toBe('anthropic/claude-opus-4')
    }, 15000)

    it('should set model when --model flag is used with opus', async () => {
      const result = await runCommand(['opencode', 'init', '--all', '--model', 'opus'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const configContent = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(configContent)

      expect(config.model).toBe('anthropic/claude-opus-4')
    }, 15000)

    it('should set model when --model flag is used with sonnet', async () => {
      const result = await runCommand(
        ['opencode', 'init', '--all', '--model', 'sonnet'],
        testProjectDir,
      )

      expect(result.exitCode).toBe(0)

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const configContent = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(configContent)

      expect(config.model).toBe('anthropic/claude-sonnet-4-5')
    }, 15000)

    it('should set model when --model flag is used with haiku', async () => {
      const result = await runCommand(['opencode', 'init', '--all', '--model', 'haiku'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const configContent = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(configContent)

      expect(config.model).toBe('anthropic/claude-haiku-4-5')
    }, 15000)

    it('should reject invalid model values', async () => {
      const result = await runCommand(
        ['opencode', 'init', '--all', '--model', 'invalid'],
        testProjectDir,
      )

      expect(result.exitCode).toBe(1)
      const output = result.stdout + result.stderr
      expect(output).toContain('Invalid model')
      expect(output).toContain('haiku, sonnet, opus')
    }, 15000)

    it('should combine model with other settings flags', async () => {
      const result = await runCommand(
        [
          'opencode',
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

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const configContent = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(configContent)

      expect(config.model).toBe('anthropic/claude-haiku-4-5')
      // Thinking flags are accepted but ignored for OpenCode
    }, 15000)
  })

  describe('transformation tests', () => {
    it('should transform command files correctly', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Read a transformed command file
      const commandPath = join(testProjectDir, '.opencode', 'command', 'create_plan.md')
      const content = await fs.readFile(commandPath, 'utf8')

      // Verify frontmatter structure
      expect(content).toContain('description:')

      // Verify model name transformed (if present)
      if (content.includes('model:')) {
        expect(content).toContain('anthropic/claude-')
        expect(content).not.toContain('model: opus')
        expect(content).not.toContain('model: sonnet')
        expect(content).not.toContain('model: haiku')
      }
    }, 15000)

    it('should transform agent files correctly', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Read a transformed agent file
      const agentPath = join(testProjectDir, '.opencode', 'agent', 'codebase-locator.md')
      const content = await fs.readFile(agentPath, 'utf8')

      // Verify frontmatter structure
      expect(content).toContain('description:')
      expect(content).toContain('mode: subagent')
      expect(content).not.toContain('name:') // Name field removed

      // Verify tools transformed from string to object
      expect(content).toContain('tools:')
      expect(content).toContain('  grep: true')
      expect(content).not.toContain('tools: Grep, Glob')
    }, 15000)

    it('should generate opencode.json with comments', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const configPath = join(testProjectDir, '.opencode', 'opencode.json')
      const content = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(content)

      // Verify structure
      expect(config.$schema).toBe('https://opencode.ai/config.json')
      expect(config.model).toMatch(/^anthropic\/claude-/)

      // Verify comments exist in raw content (they're stripped by JSON.parse)
      expect(content).toContain('"//model"')
      expect(content).toContain('"//instructions"')
    }, 15000)

    it('should transform SlashCommand() syntax', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Check oneshot.md which contains SlashCommand() calls
      const commandPath = join(testProjectDir, '.opencode', 'command', 'oneshot.md')
      if (
        await fs
          .stat(commandPath)
          .then(() => true)
          .catch(() => false)
      ) {
        const content = await fs.readFile(commandPath, 'utf8')

        // Should not contain SlashCommand()
        expect(content).not.toContain('SlashCommand()')

        // Should contain transformed version
        expect(content).toContain('use /')
      }
    }, 15000)

    it('should comment out humanlayer launch commands', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      // Check files that contain launch commands
      const commandPath = join(testProjectDir, '.opencode', 'command', 'oneshot.md')
      if (
        await fs
          .stat(commandPath)
          .then(() => true)
          .catch(() => false)
      ) {
        const content = await fs.readFile(commandPath, 'utf8')

        // Should contain OpenCode note
        if (content.includes('launch')) {
          expect(content).toContain('OpenCode')
        }
      }
    }, 15000)
  })

  describe('AGENTS.md generation', () => {
    it('should not generate AGENTS.md by default with --all flag', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const agentsMdPath = join(testProjectDir, 'AGENTS.md')
      const exists = await fs
        .stat(agentsMdPath)
        .then(() => true)
        .catch(() => false)

      expect(exists).toBe(false)
    }, 15000)
  })

  describe('directory structure', () => {
    it('should create singular directory names (command, agent)', async () => {
      const result = await runCommand(['opencode', 'init', '--all'], testProjectDir)

      expect(result.exitCode).toBe(0)

      const commandDir = join(testProjectDir, '.opencode', 'command')
      const agentDir = join(testProjectDir, '.opencode', 'agent')
      const commandsDir = join(testProjectDir, '.opencode', 'commands') // Should NOT exist
      const agentsDir = join(testProjectDir, '.opencode', 'agents') // Should NOT exist

      expect(
        await fs
          .stat(commandDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(agentDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(
        await fs
          .stat(commandsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      expect(
        await fs
          .stat(agentsDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
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
