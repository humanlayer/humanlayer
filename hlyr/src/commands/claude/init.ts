import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import * as p from '@clack/prompts'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

type ModelType = 'haiku' | 'sonnet' | 'opus'

interface InitOptions {
  force?: boolean
  all?: boolean
  alwaysThinking?: boolean
  maxThinkingTokens?: number
  model?: ModelType
}

function ensureGitignoreEntry(targetDir: string, entry: string): void {
  const gitignorePath = path.join(targetDir, '.gitignore')

  // Read existing .gitignore or create empty
  let gitignoreContent = ''
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')
  }

  // Check if entry already exists
  const lines = gitignoreContent.split('\n')
  if (lines.some(line => line.trim() === entry)) {
    return // Already exists
  }

  // Add entry with section comment
  const newContent =
    gitignoreContent +
    (gitignoreContent && !gitignoreContent.endsWith('\n') ? '\n' : '') +
    '\n# Claude Code local settings\n' +
    entry +
    '\n'

  fs.writeFileSync(gitignorePath, newContent)
}

export async function claudeInitCommand(options: InitOptions): Promise<void> {
  try {
    p.intro(chalk.blue('Initialize Claude Code Configuration'))

    // Validate model option if provided
    if (options.model && !['haiku', 'sonnet', 'opus'].includes(options.model)) {
      p.log.error(`Invalid model: ${options.model}. Must be one of: haiku, sonnet, opus`)
      process.exit(1)
    }

    // Check if running in interactive terminal
    if (!process.stdin.isTTY && !options.all) {
      p.log.error('Not running in interactive terminal.')
      p.log.info('Use --all flag to copy all files without prompting.')
      process.exit(1)
    }

    const targetDir = process.cwd()
    const claudeTargetDir = path.join(targetDir, '.claude')

    // Determine source location
    // Try multiple possible locations for the .claude directory
    const possiblePaths = [
      // When installed via npm: package root is one level up from dist
      path.resolve(__dirname, '..', '.claude'),
      // When running from repo: repo root is two levels up from dist
      path.resolve(__dirname, '../..', '.claude'),
    ]

    let sourceClaudeDir: string | null = null
    for (const candidatePath of possiblePaths) {
      if (fs.existsSync(candidatePath)) {
        sourceClaudeDir = candidatePath
        break
      }
    }

    // Verify source directory exists
    if (!sourceClaudeDir) {
      p.log.error('Source .claude directory not found in expected locations')
      p.log.info('Searched paths:')
      possiblePaths.forEach(candidatePath => {
        p.log.info(`  - ${candidatePath}`)
      })
      p.log.info('Are you running from the humanlayer repository or npm package?')
      process.exit(1)
    }

    // Check if .claude already exists
    if (fs.existsSync(claudeTargetDir) && !options.force) {
      const overwrite = await p.confirm({
        message: '.claude directory already exists. Overwrite?',
        initialValue: false,
      })

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }
    }

    let selectedCategories: string[]

    if (options.all) {
      selectedCategories = ['commands', 'agents', 'settings', 'scripts']
    } else {
      // Interactive selection
      const selection = await p.multiselect({
        message: 'What would you like to copy?',
        options: [
          {
            value: 'commands',
            label: 'Commands',
            hint: '30 workflow commands (planning, CI, research, etc.)',
          },
          {
            value: 'agents',
            label: 'Agents',
            hint: '6 specialized sub-agents for code analysis',
          },
          {
            value: 'settings',
            label: 'Settings',
            hint: 'Project permissions configuration',
          },
          {
            value: 'scripts',
            label: 'Scripts',
            hint: 'Required hack scripts (spec_metadata.sh, create_worktree.sh)',
          },
        ],
        initialValues: ['commands', 'agents', 'settings', 'scripts'],
        required: false,
      })

      if (p.isCancel(selection)) {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }

      selectedCategories = selection as string[]

      if (selectedCategories.length === 0) {
        p.cancel('No items selected.')
        process.exit(0)
      }
    }

    // Create .claude directory
    fs.mkdirSync(claudeTargetDir, { recursive: true })

    let filesCopied = 0
    let filesSkipped = 0

    // Wizard-style file selection for each category
    const filesToCopyByCategory: Record<string, string[]> = {}

    // If in interactive mode, prompt for file selection per category
    if (!options.all) {
      // Commands file selection (if selected)
      if (selectedCategories.includes('commands')) {
        const sourceDir = path.join(sourceClaudeDir, 'commands')
        if (fs.existsSync(sourceDir)) {
          const allFiles = fs.readdirSync(sourceDir)
          const fileSelection = await p.multiselect({
            message: 'Select command files to copy:',
            options: allFiles.map(file => ({
              value: file,
              label: file,
            })),
            initialValues: allFiles,
            required: false,
          })

          if (p.isCancel(fileSelection)) {
            p.cancel('Operation cancelled.')
            process.exit(0)
          }

          filesToCopyByCategory['commands'] = fileSelection as string[]

          if (filesToCopyByCategory['commands'].length === 0) {
            filesSkipped += allFiles.length
          }
        }
      }

      // Agents file selection (if selected)
      if (selectedCategories.includes('agents')) {
        const sourceDir = path.join(sourceClaudeDir, 'agents')
        if (fs.existsSync(sourceDir)) {
          const allFiles = fs.readdirSync(sourceDir)
          const fileSelection = await p.multiselect({
            message: 'Select agent files to copy:',
            options: allFiles.map(file => ({
              value: file,
              label: file,
            })),
            initialValues: allFiles,
            required: false,
          })

          if (p.isCancel(fileSelection)) {
            p.cancel('Operation cancelled.')
            process.exit(0)
          }

          filesToCopyByCategory['agents'] = fileSelection as string[]

          if (filesToCopyByCategory['agents'].length === 0) {
            filesSkipped += allFiles.length
          }
        }
      }
    }

    // Configure settings
    let alwaysThinking = options.alwaysThinking
    let maxThinkingTokens = options.maxThinkingTokens
    let model = options.model

    // Prompt for settings if in interactive mode and not provided via flags
    if (!options.all && selectedCategories.includes('settings')) {
      if (alwaysThinking === undefined) {
        const thinkingPrompt = await p.confirm({
          message: 'Enable always-on thinking mode for Claude Code?',
          initialValue: true,
        })

        if (p.isCancel(thinkingPrompt)) {
          p.cancel('Operation cancelled.')
          process.exit(0)
        }

        alwaysThinking = thinkingPrompt as boolean
      }

      if (maxThinkingTokens === undefined) {
        const tokensPrompt = await p.text({
          message: 'Maximum thinking tokens:',
          initialValue: '32000',
          validate: value => {
            const num = parseInt(value, 10)
            if (isNaN(num) || num < 1000) {
              return 'Please enter a valid number (minimum 1000)'
            }
            return undefined
          },
        })

        if (p.isCancel(tokensPrompt)) {
          p.cancel('Operation cancelled.')
          process.exit(0)
        }

        maxThinkingTokens = parseInt(tokensPrompt as string, 10)
      }

      if (model === undefined) {
        const modelPrompt = await p.select({
          message: 'Select default model:',
          options: [
            { value: 'opus' as ModelType, label: 'Opus (most capable)' },
            { value: 'sonnet' as ModelType, label: 'Sonnet (balanced)' },
            { value: 'haiku' as ModelType, label: 'Haiku (fastest)' },
          ],
          initialValue: 'opus' as ModelType,
        })

        if (p.isCancel(modelPrompt)) {
          p.cancel('Operation cancelled.')
          process.exit(0)
        }

        model = modelPrompt as ModelType
      }
    } else if (selectedCategories.includes('settings')) {
      // Non-interactive mode: use defaults if not provided
      if (alwaysThinking === undefined) {
        alwaysThinking = true
      }
      if (maxThinkingTokens === undefined) {
        maxThinkingTokens = 32000
      }
      if (model === undefined) {
        model = 'opus'
      }
    }

    // Copy selected categories
    for (const category of selectedCategories) {
      if (category === 'commands' || category === 'agents') {
        const sourceDir = path.join(sourceClaudeDir, category)
        const targetCategoryDir = path.join(claudeTargetDir, category)

        if (!fs.existsSync(sourceDir)) {
          p.log.warn(`${category} directory not found in source, skipping`)
          continue
        }

        // Get all files in category
        const allFiles = fs.readdirSync(sourceDir)

        // Determine which files to copy
        let filesToCopy = allFiles
        if (!options.all && filesToCopyByCategory[category]) {
          filesToCopy = filesToCopyByCategory[category]
        }

        if (filesToCopy.length === 0) {
          continue
        }

        // Copy files
        fs.mkdirSync(targetCategoryDir, { recursive: true })

        for (const file of filesToCopy) {
          const sourcePath = path.join(sourceDir, file)
          const targetPath = path.join(targetCategoryDir, file)

          fs.copyFileSync(sourcePath, targetPath)
          filesCopied++
        }

        filesSkipped += allFiles.length - filesToCopy.length
        p.log.success(`Copied ${filesToCopy.length} ${category} file(s)`)
      } else if (category === 'scripts') {
        // Copy required hack scripts to target repo's hack directory
        const requiredScripts = ['spec_metadata.sh', 'create_worktree.sh']
        const sourceHackDir = path.resolve(sourceClaudeDir, '..', 'hack')
        const targetHackDir = path.join(targetDir, 'hack')

        if (!fs.existsSync(sourceHackDir)) {
          p.log.warn('hack directory not found in source, skipping scripts')
          continue
        }

        // Create hack directory in target
        fs.mkdirSync(targetHackDir, { recursive: true })

        let scriptsCopied = 0
        for (const script of requiredScripts) {
          const sourcePath = path.join(sourceHackDir, script)
          const targetPath = path.join(targetHackDir, script)

          if (!fs.existsSync(sourcePath)) {
            p.log.warn(`Script ${script} not found in source, skipping`)
            continue
          }

          fs.copyFileSync(sourcePath, targetPath)
          // Make script executable (chmod +x)
          fs.chmodSync(targetPath, 0o755)
          scriptsCopied++
        }

        if (scriptsCopied > 0) {
          filesCopied += scriptsCopied
          p.log.success(`Copied ${scriptsCopied} hack script(s)`)
        }
      } else if (category === 'settings') {
        const settingsPath = path.join(sourceClaudeDir, 'settings.json')
        const targetSettingsPath = path.join(claudeTargetDir, 'settings.json')

        if (fs.existsSync(settingsPath)) {
          // Read source settings
          const settingsContent = fs.readFileSync(settingsPath, 'utf8')
          const settings = JSON.parse(settingsContent)

          // Merge user's configuration into settings
          if (alwaysThinking !== undefined) {
            settings.alwaysThinkingEnabled = alwaysThinking
          }
          if (maxThinkingTokens !== undefined) {
            if (!settings.env) {
              settings.env = {}
            }
            settings.env.MAX_THINKING_TOKENS = maxThinkingTokens.toString()
          }
          // Always set CLAUDE_BASH_MAINTAIN_WORKING_DIR to 1
          if (!settings.env) {
            settings.env = {}
          }
          settings.env.CLAUDE_BASH_MAINTAIN_WORKING_DIR = '1'
          if (model !== undefined) {
            settings.model = model
          }

          // Write modified settings
          fs.writeFileSync(targetSettingsPath, JSON.stringify(settings, null, 2) + '\n')
          filesCopied++
          p.log.success(
            `Copied settings.json (model: ${model}, alwaysThinking: ${alwaysThinking}, maxTokens: ${maxThinkingTokens})`,
          )
        } else {
          p.log.warn('settings.json not found in source, skipping')
        }
      }
    }

    // Update .gitignore to exclude settings.local.json
    if (selectedCategories.includes('settings')) {
      ensureGitignoreEntry(targetDir, '.claude/settings.local.json')
      p.log.info('Updated .gitignore to exclude settings.local.json')
    }

    // Update .gitignore to exclude hack scripts
    if (selectedCategories.includes('scripts')) {
      ensureGitignoreEntry(targetDir, 'hack/spec_metadata.sh')
      ensureGitignoreEntry(targetDir, 'hack/create_worktree.sh')
      p.log.info('Updated .gitignore to exclude hack scripts')
    }

    let message = `Successfully copied ${filesCopied} file(s) to ${claudeTargetDir}`
    if (filesSkipped > 0) {
      message += chalk.gray(`\n   Skipped ${filesSkipped} file(s)`)
    }
    message += chalk.gray('\n   You can now use these commands in Claude Code.')

    p.outro(message)
  } catch (error) {
    p.log.error(`Error during claude init: ${error}`)
    process.exit(1)
  }
}
