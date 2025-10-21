import chalk from 'chalk'
import { getDefaultConfigPath, resolveFullConfig, resolveConfigWithSources } from '../config.js'

interface ConfigShowOptions {
  configFile?: string
  slackChannel?: string
  slackBotToken?: string
  slackContext?: string
  slackThreadTs?: string
  slackBlocks?: boolean
  emailAddress?: string
  emailContext?: string
  json?: boolean
}

export function configShowCommand(options: ConfigShowOptions): void {
  try {
    const resolvedConfig = resolveFullConfig(options)

    // JSON output mode
    if (options.json) {
      const jsonOutput = {
        www_base_url: resolvedConfig.www_base_url,
        daemon_socket: resolvedConfig.daemon_socket,
        run_id: resolvedConfig.run_id,
      }

      console.log(JSON.stringify(jsonOutput, null, 2))
      return
    }

    console.log(chalk.blue('HumanLayer Configuration'))
    console.log(chalk.gray('='.repeat(50)))
    console.log('')

    // Show config file sources
    console.log(chalk.yellow('Config File Sources:'))
    const configPath = options.configFile || getDefaultConfigPath()
    console.log(`  Primary: ${configPath}`)
    console.log(`  Local: humanlayer.json`)
    console.log('')

    // Show configuration
    console.log(chalk.yellow('Configuration:'))
    console.log(`  WWW Base URL: ${chalk.cyan(resolvedConfig.www_base_url)}`)
    console.log(`  Daemon Socket: ${chalk.cyan(resolvedConfig.daemon_socket)}`)
    if (resolvedConfig.run_id) {
      console.log(`  Run ID: ${chalk.cyan(resolvedConfig.run_id)}`)
    }
    console.log('')

    // Show configuration sources
    console.log(chalk.yellow('Configuration Sources:'))
    const configWithSources = resolveConfigWithSources(options)

    if (configWithSources.www_base_url.source !== 'default') {
      console.log(
        `  WWW Base URL: ${chalk.cyan(configWithSources.www_base_url.value)} ${chalk.gray(
          `(${configWithSources.www_base_url.sourceName})`,
        )}`,
      )
    }

    if (configWithSources.daemon_socket.source !== 'default') {
      console.log(
        `  Daemon Socket: ${chalk.cyan(configWithSources.daemon_socket.value)} ${chalk.gray(
          `(${configWithSources.daemon_socket.sourceName})`,
        )}`,
      )
    }

    if (configWithSources.run_id?.value) {
      console.log(
        `  Run ID: ${chalk.cyan(configWithSources.run_id.value)} ${chalk.gray(
          `(${configWithSources.run_id.sourceName})`,
        )}`,
      )
    }

    // Show if no additional configuration is found
    const hasAdditionalConfig =
      configWithSources.www_base_url.source !== 'default' ||
      configWithSources.daemon_socket.source !== 'default' ||
      configWithSources.run_id?.value

    if (!hasAdditionalConfig) {
      console.log(chalk.gray('  Using default configuration'))
    }
  } catch (error) {
    console.error(chalk.red(`Error showing config: ${error}`))
    process.exit(1)
  }
}
