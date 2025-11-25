import { spawn } from 'child_process'
import chalk from 'chalk'
import {
  loadThoughtsConfig,
  getRepoNameFromMapping,
  getProfileNameFromMapping,
} from '../../thoughtsConfig.js'
import { getDefaultConfigPath } from '../../config.js'

interface ConfigOptions {
  edit?: boolean
  json?: boolean
  configFile?: string
}

export async function thoughtsConfigCommand(options: ConfigOptions): Promise<void> {
  try {
    const configPath = options.configFile || getDefaultConfigPath()

    // Handle edit mode
    if (options.edit) {
      const editor = process.env.EDITOR || 'vi'
      spawn(editor, [configPath], { stdio: 'inherit' })
      return
    }

    // Load configuration
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('No thoughts configuration found.'))
      console.error('Run "humanlayer thoughts init" to create one.')
      process.exit(1)
    }

    // Handle JSON output
    if (options.json) {
      console.log(JSON.stringify(config, null, 2))
      return
    }

    // Display configuration
    console.log(chalk.blue('Thoughts Configuration'))
    console.log(chalk.gray('='.repeat(50)))
    console.log('')

    console.log(chalk.yellow('Settings:'))
    console.log(`  Config file: ${chalk.cyan(configPath)}`)
    console.log(`  Thoughts repository: ${chalk.cyan(config.thoughtsRepo)}`)
    console.log(`  Repos directory: ${chalk.cyan(config.reposDir)}`)
    console.log(`  Global directory: ${chalk.cyan(config.globalDir)}`)
    console.log(`  User: ${chalk.cyan(config.user)}`)
    console.log('')

    console.log(chalk.yellow('Repository Mappings:'))
    const mappings = Object.entries(config.repoMappings)

    if (mappings.length === 0) {
      console.log(chalk.gray('  No repositories mapped yet'))
    } else {
      mappings.forEach(([repo, mapping]) => {
        const repoName = getRepoNameFromMapping(mapping)
        const profileName = getProfileNameFromMapping(mapping)

        console.log(`  ${chalk.cyan(repo)}`)
        console.log(`    → ${chalk.green(`${config.reposDir}/${repoName}`)}`)

        if (profileName) {
          console.log(`    Profile: ${chalk.yellow(profileName)}`)
        } else {
          console.log(`    Profile: ${chalk.gray('(default)')}`)
        }
      })
    }

    console.log('')

    // Add profiles section
    console.log(chalk.yellow('Profiles:'))
    if (!config.profiles || Object.keys(config.profiles).length === 0) {
      console.log(chalk.gray('  No profiles configured'))
    } else {
      Object.keys(config.profiles).forEach(name => {
        console.log(`  ${chalk.cyan(name)}`)
      })
    }

    console.log('')
    console.log(chalk.gray('To edit configuration, run: humanlayer thoughts config --edit'))
  } catch (error) {
    console.error(chalk.red(`Error showing thoughts config: ${error}`))
    process.exit(1)
  }
}
