import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { loadThoughtsConfig, saveThoughtsConfig, getCurrentRepoPath } from '../../thoughtsConfig.js'

interface UninitOptions {
  force?: boolean
  configFile?: string
}

export async function thoughtsUninitCommand(options: UninitOptions): Promise<void> {
  try {
    const currentRepo = getCurrentRepoPath()
    const thoughtsDir = path.join(currentRepo, 'thoughts')

    // Check if thoughts directory exists
    if (!fs.existsSync(thoughtsDir)) {
      console.error(chalk.red('Error: Thoughts not initialized for this repository.'))
      process.exit(1)
    }

    // Load config
    const config = loadThoughtsConfig(options)
    if (!config) {
      console.error(chalk.red('Error: Thoughts configuration not found.'))
      process.exit(1)
    }

    const mappedName = config.repoMappings[currentRepo]
    if (!mappedName && !options.force) {
      console.error(chalk.red('Error: This repository is not in the thoughts configuration.'))
      console.error(chalk.yellow('Use --force to remove the thoughts directory anyway.'))
      process.exit(1)
    }

    console.log(chalk.blue('Removing thoughts setup from current repository...'))

    // Step 1: Handle searchable directory if it exists
    const searchableDir = path.join(thoughtsDir, 'searchable')
    if (fs.existsSync(searchableDir)) {
      console.log(chalk.gray('Removing searchable directory...'))
      try {
        // Reset permissions in case they're restricted
        execSync(`chmod -R 755 "${searchableDir}"`, { stdio: 'pipe' })
      } catch {
        // Ignore chmod errors
      }
      fs.rmSync(searchableDir, { recursive: true, force: true })
    }

    // Step 2: Remove the entire thoughts directory
    // IMPORTANT: This only removes the local thoughts/ directory containing symlinks
    // The actual thoughts content in the thoughts repository remains untouched
    console.log(chalk.gray('Removing thoughts directory (symlinks only)...'))
    try {
      fs.rmSync(thoughtsDir, { recursive: true, force: true })
    } catch (error) {
      console.error(chalk.red(`Error removing thoughts directory: ${error}`))
      console.error(chalk.yellow('You may need to manually remove: ' + thoughtsDir))
      process.exit(1)
    }

    // Step 3: Remove from config if mapped
    if (mappedName) {
      console.log(chalk.gray('Removing repository from thoughts configuration...'))
      delete config.repoMappings[currentRepo]
      saveThoughtsConfig(config, options)
    }

    console.log(chalk.green('✅ Thoughts removed from repository'))

    // Provide info about what was done
    if (mappedName) {
      console.log('')
      console.log(chalk.gray('Note: Your thoughts content remains safe in:'))
      console.log(chalk.gray(`  ${config.thoughtsRepo}/${config.reposDir}/${mappedName}`))
      console.log(chalk.gray('Only the local symlinks and configuration were removed.'))
    }
  } catch (error) {
    console.error(chalk.red(`Error during thoughts uninit: ${error}`))
    process.exit(1)
  }
}
