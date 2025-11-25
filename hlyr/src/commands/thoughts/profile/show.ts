import chalk from 'chalk'
import { loadThoughtsConfig, validateProfile } from '../../../thoughtsConfig.js'

interface ShowOptions {
  json?: boolean
  configFile?: string
}

export async function profileShowCommand(profileName: string, options: ShowOptions): Promise<void> {
  try {
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured.'))
      process.exit(1)
    }

    if (!validateProfile(config, profileName)) {
      console.error(chalk.red(`Error: Profile "${profileName}" not found.`))
      console.error('')
      console.error(chalk.gray('Available profiles:'))
      if (config.profiles) {
        Object.keys(config.profiles).forEach(name => {
          console.error(chalk.gray(`  - ${name}`))
        })
      } else {
        console.error(chalk.gray('  (none)'))
      }
      process.exit(1)
    }

    const profile = config.profiles![profileName]

    if (options.json) {
      console.log(JSON.stringify(profile, null, 2))
      return
    }

    console.log(chalk.blue(`Profile: ${profileName}`))
    console.log(chalk.gray('='.repeat(50)))
    console.log('')
    console.log(chalk.yellow('Configuration:'))
    console.log(`  Thoughts repository: ${chalk.cyan(profile.thoughtsRepo)}`)
    console.log(`  Repos directory: ${chalk.cyan(profile.reposDir)}`)
    console.log(`  Global directory: ${chalk.cyan(profile.globalDir)}`)
    console.log('')

    // Count repositories using this profile
    let repoCount = 0
    Object.values(config.repoMappings).forEach(mapping => {
      if (typeof mapping === 'object' && mapping.profile === profileName) {
        repoCount++
      }
    })

    console.log(chalk.yellow('Usage:'))
    console.log(`  Repositories using this profile: ${chalk.cyan(repoCount)}`)
  } catch (error) {
    console.error(chalk.red(`Error showing profile: ${error}`))
    process.exit(1)
  }
}
