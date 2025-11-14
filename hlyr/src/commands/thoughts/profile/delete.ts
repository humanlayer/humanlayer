import chalk from 'chalk'
import readline from 'readline'
import { loadThoughtsConfig, saveThoughtsConfig, validateProfile } from '../../../thoughtsConfig.js'

interface DeleteOptions {
  force?: boolean
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

export async function profileDeleteCommand(profileName: string, options: DeleteOptions): Promise<void> {
  try {
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured.'))
      process.exit(1)
    }

    if (!validateProfile(config, profileName)) {
      console.error(chalk.red(`Error: Profile "${profileName}" not found.`))
      process.exit(1)
    }

    // Check if any repositories are using this profile
    const usingRepos: string[] = []
    Object.entries(config.repoMappings).forEach(([repoPath, mapping]) => {
      if (typeof mapping === 'object' && mapping.profile === profileName) {
        usingRepos.push(repoPath)
      }
    })

    if (usingRepos.length > 0 && !options.force) {
      console.error(
        chalk.red(`Error: Profile "${profileName}" is in use by ${usingRepos.length} repository(ies):`),
      )
      console.error('')
      usingRepos.forEach(repo => {
        console.error(chalk.gray(`  - ${repo}`))
      })
      console.error('')
      console.error(chalk.yellow('Options:'))
      console.error(chalk.gray('  1. Run "humanlayer thoughts uninit" in each repository'))
      console.error(
        chalk.gray('  2. Use --force to delete anyway (repos will fall back to default config)'),
      )
      process.exit(1)
    }

    // Confirm deletion
    if (!options.force) {
      console.log(chalk.yellow(`\nYou are about to delete profile: ${chalk.cyan(profileName)}`))
      console.log(chalk.gray('This will remove the profile configuration.'))
      console.log(chalk.gray('The thoughts repository files will NOT be deleted.'))
      console.log('')
      const confirm = await prompt('Are you sure? (y/N): ')

      if (confirm.toLowerCase() !== 'y') {
        console.log('Deletion cancelled.')
        return
      }
    }

    // Delete profile
    delete config.profiles![profileName]

    // If profiles is now empty, remove it entirely
    if (Object.keys(config.profiles!).length === 0) {
      delete config.profiles
    }

    // Save config
    saveThoughtsConfig(config, options)

    console.log(chalk.green(`\n✅ Profile "${profileName}" deleted`))

    if (usingRepos.length > 0) {
      console.log('')
      console.log(
        chalk.yellow('⚠️  Warning: Repositories using this profile will fall back to default config'),
      )
    }
  } catch (error) {
    console.error(chalk.red(`Error deleting profile: ${error}`))
    process.exit(1)
  }
}
