import chalk from 'chalk'
import {
  getDefaultConfigPath,
  resolveFullConfig,
  resolveConfigWithSources,
  maskSensitiveValue,
} from '../config.js'

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
        api_key: resolvedConfig.api_key ? maskSensitiveValue(resolvedConfig.api_key) : undefined,
        api_base_url: resolvedConfig.api_base_url,
        app_base_url: resolvedConfig.app_base_url,
        contact_channel: resolvedConfig.contact_channel,
      }

      // Mask bot token if present
      if (jsonOutput.contact_channel.slack?.bot_token) {
        jsonOutput.contact_channel.slack.bot_token = maskSensitiveValue(
          jsonOutput.contact_channel.slack.bot_token,
        )
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

    // Show API configuration
    console.log(chalk.yellow('API Configuration:'))
    const apiKey = resolvedConfig.api_key || '<not set>'

    const displayApiKey =
      apiKey === '<not set>' ? chalk.red(apiKey) : chalk.green(maskSensitiveValue(apiKey))
    console.log(`  API Key: ${displayApiKey}`)
    console.log(`  API Base URL: ${chalk.cyan(resolvedConfig.api_base_url)}`)
    console.log(`  App Base URL: ${chalk.cyan(resolvedConfig.app_base_url)}`)
    console.log('')

    // Show computed contact channel
    console.log(chalk.yellow('Contact Channel Configuration:'))
    const contactChannel = resolvedConfig.contact_channel

    if (contactChannel.slack) {
      console.log(`  Slack:`)
      console.log(
        `    Channel/User ID: ${chalk.cyan(contactChannel.slack.channel_or_user_id || '<not set>')}`,
      )
      const displayBotToken = contactChannel.slack.bot_token
        ? chalk.green(maskSensitiveValue(contactChannel.slack.bot_token))
        : chalk.red('<not set>')
      console.log(`    Bot Token: ${displayBotToken}`)
      console.log(
        `    Context: ${chalk.cyan(contactChannel.slack.context_about_channel_or_user || '<not set>')}`,
      )
      console.log(`    Thread TS: ${chalk.cyan(contactChannel.slack.thread_ts || '<not set>')}`)
      console.log(`    Blocks: ${chalk.cyan(contactChannel.slack.experimental_slack_blocks)}`)
    }

    if (contactChannel.email) {
      console.log(`  Email:`)
      console.log(`    Address: ${chalk.cyan(contactChannel.email.address)}`)
      console.log(`    Context: ${chalk.cyan(contactChannel.email.context_about_user || '<not set>')}`)
    }

    if (!contactChannel.slack && !contactChannel.email) {
      console.log(chalk.gray('  No contact channel configured'))
    }
    console.log('')

    // Show configuration sources
    console.log(chalk.yellow('Configuration Sources:'))
    const configWithSources = resolveConfigWithSources(options)

    // Show API configuration sources
    if (configWithSources.api_key?.value) {
      const displayValue = maskSensitiveValue(configWithSources.api_key.value)
      console.log(
        `  API Key: ${chalk.green(displayValue)} ${chalk.gray(
          `(${configWithSources.api_key.sourceName})`,
        )}`,
      )
    }

    if (configWithSources.api_base_url.source !== 'default') {
      console.log(
        `  API Base URL: ${chalk.cyan(configWithSources.api_base_url.value)} ${chalk.gray(
          `(${configWithSources.api_base_url.sourceName})`,
        )}`,
      )
    }

    if (configWithSources.app_base_url.source !== 'default') {
      console.log(
        `  App Base URL: ${chalk.cyan(configWithSources.app_base_url.value)} ${chalk.gray(
          `(${configWithSources.app_base_url.sourceName})`,
        )}`,
      )
    }

    // Show configured environment variables that aren't already shown above
    const otherEnvVars = [
      'HUMANLAYER_SLACK_CHANNEL',
      'HUMANLAYER_SLACK_BOT_TOKEN',
      'HUMANLAYER_SLACK_CONTEXT',
      'HUMANLAYER_SLACK_THREAD_TS',
      'HUMANLAYER_SLACK_BLOCKS',
      'HUMANLAYER_EMAIL_ADDRESS',
      'HUMANLAYER_EMAIL_CONTEXT',
    ]

    otherEnvVars.forEach(envVar => {
      const value = process.env[envVar]
      if (value) {
        const displayValue =
          envVar.includes('TOKEN') || envVar.includes('KEY') ? maskSensitiveValue(value) : value
        console.log(`  ${envVar}: ${chalk.green(displayValue)} ${chalk.gray('(env)')}`)
      }
    })

    // Show if no additional configuration is found
    const hasAdditionalConfig =
      configWithSources.api_key?.value ||
      configWithSources.api_base_url.source !== 'default' ||
      configWithSources.app_base_url.source !== 'default' ||
      otherEnvVars.some(envVar => process.env[envVar])

    if (!hasAdditionalConfig) {
      console.log(chalk.gray('  Using default configuration'))
    }
  } catch (error) {
    console.error(chalk.red(`Error showing config: ${error}`))
    process.exit(1)
  }
}
