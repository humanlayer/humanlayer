import chalk from 'chalk'
import { loadThoughtsConfig } from '../../../thoughtsConfig.js'

interface ListOptions {
  json?: boolean
  configFile?: string
}

export async function profileListCommand(options: ListOptions): Promise<void> {
  try {
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured.'))
      process.exit(1)
    }

    if (options.json) {
      console.log(JSON.stringify(config.profiles || {}, null, 2))
      return
    }

    console.log(chalk.blue('Thoughts Profiles'))
    console.log(chalk.gray('='.repeat(50)))
    console.log('')

    // Show default config
    console.log(chalk.yellow('Default Configuration:'))
    console.log(`  Thoughts repository: ${chalk.cyan(config.thoughtsRepo)}`)
    console.log(`  Repos directory: ${chalk.cyan(config.reposDir)}`)
    console.log(`  Global directory: ${chalk.cyan(config.globalDir)}`)
    console.log('')

    // Show profiles
    if (!config.profiles || Object.keys(config.profiles).length === 0) {
      console.log(chalk.gray('No profiles configured.'))
      console.log('')
      console.log(chalk.gray('Create a profile with: humanlayer thoughts profile create <name>'))
    } else {
      console.log(chalk.yellow(`Profiles (${Object.keys(config.profiles).length}):`))
      console.log('')

      Object.entries(config.profiles).forEach(([name, profile]) => {
        console.log(chalk.cyan(`  ${name}:`))
        console.log(`    Thoughts repository: ${profile.thoughtsRepo}`)
        console.log(`    Repos directory: ${profile.reposDir}`)
        console.log(`    Global directory: ${profile.globalDir}`)
        console.log('')
      })
    }
  } catch (error) {
    console.error(chalk.red(`Error listing profiles: ${error}`))
    process.exit(1)
  }
}
