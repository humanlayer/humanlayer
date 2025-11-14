import chalk from 'chalk'
import readline from 'readline'
import {
  loadThoughtsConfig,
  saveThoughtsConfig,
  getDefaultThoughtsRepo,
  ensureThoughtsRepoExists,
  sanitizeProfileName,
  validateProfile,
} from '../../../thoughtsConfig.js'
import type { ProfileConfig } from '../../../config.js'

interface CreateOptions {
  repo?: string
  reposDir?: string
  globalDir?: string
  configFile?: string
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

export async function profileCreateCommand(profileName: string, options: CreateOptions): Promise<void> {
  try {
    // Load existing config
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured.'))
      console.error('Run "humanlayer thoughts init" first to set up the base configuration.')
      process.exit(1)
    }

    // Sanitize profile name
    const sanitizedName = sanitizeProfileName(profileName)
    if (sanitizedName !== profileName) {
      console.log(chalk.yellow(`Profile name sanitized: "${profileName}" → "${sanitizedName}"`))
    }

    // Check if profile already exists
    if (validateProfile(config, sanitizedName)) {
      console.error(chalk.red(`Error: Profile "${sanitizedName}" already exists.`))
      console.error('Use a different name or delete the existing profile first.')
      process.exit(1)
    }

    // Get profile configuration
    let thoughtsRepo: string
    let reposDir: string
    let globalDir: string

    if (options.repo && options.reposDir && options.globalDir) {
      // Non-interactive mode
      thoughtsRepo = options.repo
      reposDir = options.reposDir
      globalDir = options.globalDir
    } else {
      // Interactive mode
      console.log(chalk.blue(`\n=== Creating Profile: ${sanitizedName} ===\n`))

      const defaultRepo = getDefaultThoughtsRepo() + `-${sanitizedName}`
      console.log(chalk.gray('Specify the thoughts repository location for this profile.'))
      const repoInput = await prompt(`Thoughts repository [${defaultRepo}]: `)
      thoughtsRepo = repoInput || defaultRepo

      console.log('')
      const reposDirInput = await prompt(`Repository-specific thoughts directory [repos]: `)
      reposDir = reposDirInput || 'repos'

      const globalDirInput = await prompt(`Global thoughts directory [global]: `)
      globalDir = globalDirInput || 'global'
    }

    // Create profile config
    const profileConfig: ProfileConfig = {
      thoughtsRepo,
      reposDir,
      globalDir,
    }

    // Initialize profiles object if it doesn't exist
    if (!config.profiles) {
      config.profiles = {}
    }

    // Add profile
    config.profiles[sanitizedName] = profileConfig

    // Save config
    saveThoughtsConfig(config, options)

    // Create the profile's thoughts repository structure
    console.log(chalk.gray('\nInitializing profile thoughts repository...'))
    ensureThoughtsRepoExists(profileConfig)

    console.log(chalk.green(`\n✅ Profile "${sanitizedName}" created successfully!`))
    console.log('')
    console.log(chalk.blue('=== Profile Configuration ==='))
    console.log(`  Name: ${chalk.cyan(sanitizedName)}`)
    console.log(`  Thoughts repository: ${chalk.cyan(thoughtsRepo)}`)
    console.log(`  Repos directory: ${chalk.cyan(reposDir)}`)
    console.log(`  Global directory: ${chalk.cyan(globalDir)}`)
    console.log('')
    console.log(chalk.gray('Next steps:'))
    console.log(
      chalk.gray(`  1. Run "humanlayer thoughts init --profile ${sanitizedName}" in a repository`),
    )
    console.log(chalk.gray(`  2. Your thoughts will sync to the profile's repository`))
  } catch (error) {
    console.error(chalk.red(`Error creating profile: ${error}`))
    process.exit(1)
  }
}
