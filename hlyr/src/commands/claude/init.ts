import fs from 'fs'
import path from 'path'
import readline from 'readline'
import chalk from 'chalk'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface InitOptions {
  force?: boolean
  all?: boolean
}

interface SelectionItem {
  title: string
  value: string
  selected: boolean
  description?: string
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
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

async function multiselect(message: string, items: SelectionItem[]): Promise<string[]> {
  console.log(chalk.cyan(message))
  console.log(chalk.gray('(Use space to select, enter to confirm)'))
  console.log('')

  // Display items with checkbox
  items.forEach(item => {
    const checkbox = item.selected ? chalk.green('◉') : chalk.gray('◯')
    const label = item.selected ? chalk.green(item.title) : item.title
    const desc = item.description ? chalk.gray(` - ${item.description}`) : ''
    console.log(`  ${checkbox} ${label}${desc}`)
  })

  console.log('')
  console.log(
    chalk.gray('Enter space-separated numbers to toggle (e.g., "1 3 4"), or press enter to continue:'),
  )

  const answer = await prompt('Selection: ')

  if (answer.trim()) {
    // Parse space-separated numbers
    const toggleIndices = answer
      .trim()
      .split(/\s+/)
      .map(n => parseInt(n) - 1)
      .filter(n => n >= 0 && n < items.length)

    // Toggle selected items
    toggleIndices.forEach(idx => {
      items[idx].selected = !items[idx].selected
    })

    // Recurse to show updated UI
    return multiselect(message, items)
  }

  // Return selected values
  return items.filter(item => item.selected).map(item => item.value)
}

export async function claudeInitCommand(options: InitOptions): Promise<void> {
  try {
    console.log(chalk.blue('=== Initialize Claude Code Configuration ==='))
    console.log('')

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
      console.error(chalk.red(`Error: Source .claude directory not found at ${sourceClaudeDir}`))
      console.error(chalk.gray('Are you running from the humanlayer repository or npm package?'))
      process.exit(1)
    }

    // Check if .claude already exists
    if (fs.existsSync(claudeTargetDir) && !options.force) {
      console.log(chalk.yellow('.claude directory already exists.'))
      const proceed = await prompt('Overwrite existing configuration? (y/N): ')
      if (proceed.toLowerCase() !== 'y') {
        console.log(chalk.gray('Operation cancelled.'))
        return
      }
    }

    let selectedCategories: string[]

    if (options.all) {
      selectedCategories = ['commands', 'agents', 'settings']
    } else {
      // Interactive selection
      const categories: SelectionItem[] = [
        {
          title: 'Commands',
          value: 'commands',
          selected: true,
          description: '30 workflow commands (planning, CI, research, etc.)',
        },
        {
          title: 'Agents',
          value: 'agents',
          selected: true,
          description: '6 specialized sub-agents for code analysis',
        },
        {
          title: 'Settings',
          value: 'settings',
          selected: true,
          description: 'Project permissions configuration',
        },
      ]

      selectedCategories = await multiselect('What would you like to copy?', categories)

      if (selectedCategories.length === 0) {
        console.log(chalk.gray('No items selected. Operation cancelled.'))
        return
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
          console.log(chalk.yellow(`⚠ ${category} directory not found in source, skipping`))
          continue
        }

        // Get all files in category
        const allFiles = fs.readdirSync(sourceDir)

        // For commands, allow variant selection
        let filesToCopy = allFiles

        if (category === 'commands' && !options.all) {
          // Show file selection
          const fileItems: SelectionItem[] = allFiles.map(file => ({
            title: file,
            value: file,
            selected: true,
          }))

          console.log('')
          filesToCopy = await multiselect(`Select command files to copy:`, fileItems)

          if (filesToCopy.length === 0) {
            console.log(chalk.gray(`No ${category} files selected, skipping`))
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
        console.log(chalk.green(`✓ Copied ${filesToCopy.length} ${category} file(s)`))
      } else if (category === 'settings') {
        const settingsPath = path.join(sourceClaudeDir, 'settings.json')
        const targetSettingsPath = path.join(claudeTargetDir, 'settings.json')

        if (fs.existsSync(settingsPath)) {
          fs.copyFileSync(settingsPath, targetSettingsPath)
          filesCopied++
          console.log(chalk.green('✓ Copied settings.json'))
        } else {
          console.log(chalk.yellow('⚠ settings.json not found in source, skipping'))
        }
      }
    }

    // Update .gitignore to exclude settings.local.json
    if (selectedCategories.includes('settings')) {
      ensureGitignoreEntry(targetDir, '.claude/settings.local.json')
      console.log(chalk.gray('✓ Updated .gitignore to exclude settings.local.json'))
    }

    console.log('')
    console.log(chalk.green(`✅ Successfully copied ${filesCopied} file(s) to ${claudeTargetDir}`))
    if (filesSkipped > 0) {
      console.log(chalk.gray(`   Skipped ${filesSkipped} file(s)`))
    }
    console.log('')
    console.log(chalk.gray('You can now use these commands in Claude Code.'))
  } catch (error) {
    console.error(chalk.red(`Error during claude init: ${error}`))
    process.exit(1)
  }
}
