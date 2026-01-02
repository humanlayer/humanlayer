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
  model?: string
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
    '\n# OpenCode local settings\n' +
    entry +
    '\n'

  fs.writeFileSync(gitignorePath, newContent)
}

export async function opencodeInitCommand(options: InitOptions): Promise<void> {
  try {
    p.intro(chalk.blue('Initialize OpenCode Configuration'))

    // Check if running in interactive terminal
    if (!process.stdin.isTTY && !options.all) {
      p.log.error('Not running in interactive terminal.')
      p.log.info('Use --all flag to copy all files without prompting.')
      process.exit(1)
    }

    const targetDir = process.cwd()
    const opencodeTargetDir = path.join(targetDir, '.opencode')

    // Determine source location
    // Try multiple possible locations for the .opencode directory
    const possiblePaths = [
      // When installed via npm: package root is one level up from dist
      path.resolve(__dirname, '..', '.opencode'),
      // When running from repo: repo root is two levels up from dist
      path.resolve(__dirname, '../..', '.opencode'),
    ]

    let sourceOpencodeDir: string | null = null
    for (const candidatePath of possiblePaths) {
      if (fs.existsSync(candidatePath)) {
        sourceOpencodeDir = candidatePath
        break
      }
    }

    // Verify source directory exists
    if (!sourceOpencodeDir) {
      p.log.error('Source .opencode directory not found in expected locations')
      p.log.info('Searched paths:')
      possiblePaths.forEach(candidatePath => {
        p.log.info(`  - ${candidatePath}`)
      })
      p.log.info('Are you running from the humanlayer repository or npm package?')
      process.exit(1)
    }

    // Check if .opencode already exists
    if (fs.existsSync(opencodeTargetDir) && !options.force) {
      const overwrite = await p.confirm({
        message: '.opencode directory already exists. Overwrite?',
        initialValue: false,
      })

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }
    }

    let selectedCategories: string[]

    if (options.all) {
      selectedCategories = ['commands', 'agents', 'config']
    } else {
      // Interactive selection
      const selection = await p.multiselect({
        message: 'What would you like to copy?',
        options: [
          {
            value: 'commands',
            label: 'Commands',
            hint: 'Workflow commands (planning, research, commit, etc.)',
          },
          {
            value: 'agents',
            label: 'Agents',
            hint: 'Specialized sub-agents for code analysis',
          },
          {
            value: 'config',
            label: 'Configuration',
            hint: 'OpenCode settings and rules (opencode.json, AGENTS.md)',
          },
        ],
        initialValues: ['commands', 'agents', 'config'],
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

    // Create .opencode directory
    fs.mkdirSync(opencodeTargetDir, { recursive: true })

    let filesCopied = 0
    let filesSkipped = 0

    // Wizard-style file selection for each category
    const filesToCopyByCategory: Record<string, string[]> = {}

    // If in interactive mode, prompt for file selection per category
    if (!options.all) {
      // Commands file selection (if selected)
      if (selectedCategories.includes('commands')) {
        const sourceDir = path.join(sourceOpencodeDir, 'commands')
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
        const sourceDir = path.join(sourceOpencodeDir, 'agents')
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

    // Configure model if in interactive mode
    let model = options.model
    if (!options.all && selectedCategories.includes('config') && model === undefined) {
      const modelPrompt = await p.text({
        message: 'Default model (provider/model format, e.g., anthropic/claude-sonnet-4-20250514):',
        initialValue: 'anthropic/claude-sonnet-4-20250514',
        placeholder: 'anthropic/claude-sonnet-4-20250514',
      })

      if (p.isCancel(modelPrompt)) {
        p.cancel('Operation cancelled.')
        process.exit(0)
      }

      model = modelPrompt as string
    } else if (selectedCategories.includes('config') && model === undefined) {
      model = 'anthropic/claude-sonnet-4-20250514'
    }

    // Copy selected categories
    for (const category of selectedCategories) {
      if (category === 'commands' || category === 'agents') {
        const sourceDir = path.join(sourceOpencodeDir, category)
        const targetCategoryDir = path.join(opencodeTargetDir, category)

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
      } else if (category === 'config') {
        // Copy opencode.json
        const configPath = path.join(sourceOpencodeDir, 'opencode.json')
        const targetConfigPath = path.join(opencodeTargetDir, 'opencode.json')

        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, 'utf8')
          const config = JSON.parse(configContent)

          // Set user's model preference
          if (model) {
            config.model = model
          }

          fs.writeFileSync(targetConfigPath, JSON.stringify(config, null, 2) + '\n')
          filesCopied++
          p.log.success(`Copied opencode.json (model: ${model || 'default'})`)
        }

        // Copy AGENTS.md (rules file)
        const agentsPath = path.join(sourceOpencodeDir, 'AGENTS.md')
        const targetAgentsPath = path.join(opencodeTargetDir, 'AGENTS.md')

        if (fs.existsSync(agentsPath)) {
          fs.copyFileSync(agentsPath, targetAgentsPath)
          filesCopied++
          p.log.success('Copied AGENTS.md (project rules)')
        }
      }
    }

    // Update .gitignore to exclude local config
    if (selectedCategories.includes('config')) {
      ensureGitignoreEntry(targetDir, '.opencode/opencode.local.json')
      p.log.info('Updated .gitignore to exclude opencode.local.json')
    }

    let message = `Successfully copied ${filesCopied} file(s) to ${opencodeTargetDir}`
    if (filesSkipped > 0) {
      message += chalk.gray(`\n   Skipped ${filesSkipped} file(s)`)
    }
    message += chalk.gray('\n   You can now use these commands in OpenCode.')
    message += chalk.gray('\n   Run `opencode` in this directory to start.')

    p.outro(message)
  } catch (error) {
    p.log.error(`Error during opencode init: ${error}`)
    process.exit(1)
  }
}
