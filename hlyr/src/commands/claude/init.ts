import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import * as p from '@clack/prompts'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface InitOptions {
  force?: boolean
  all?: boolean
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

    // Check if running in interactive terminal
    if (!process.stdin.isTTY && !options.all) {
      p.log.error('Not running in interactive terminal.')
      p.log.info('Use --all flag to copy all files without prompting.')
      process.exit(1)
    }

    const targetDir = process.cwd()
    const claudeTargetDir = path.join(targetDir, '.claude')

    // Determine source location
    // When installed via npm: node_modules/humanlayer/.claude
    // When running from repo: ../../.claude (from hlyr/dist/ to repo root)
    // Note: The build bundles everything into dist/index.js, so __dirname points to hlyr/dist/
    const repoRoot = path.resolve(__dirname, '../..')
    const sourceClaudeDir = path.join(repoRoot, '.claude')

    // Verify source directory exists
    if (!fs.existsSync(sourceClaudeDir)) {
      p.log.error(`Source .claude directory not found at ${sourceClaudeDir}`)
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
      selectedCategories = ['commands', 'agents', 'settings']
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
        ],
        initialValues: ['commands', 'agents', 'settings'],
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

        // For commands, allow variant selection
        let filesToCopy = allFiles

        if (category === 'commands' && !options.all) {
          // Show file selection
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

          filesToCopy = fileSelection as string[]

          if (filesToCopy.length === 0) {
            filesSkipped += allFiles.length
            continue
          }
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
      } else if (category === 'settings') {
        const settingsPath = path.join(sourceClaudeDir, 'settings.json')
        const targetSettingsPath = path.join(claudeTargetDir, 'settings.json')

        if (fs.existsSync(settingsPath)) {
          fs.copyFileSync(settingsPath, targetSettingsPath)
          filesCopied++
          p.log.success('Copied settings.json')
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
