import chalk from 'chalk'
import { getDefaultConfigPath, resolveFullConfig } from '../config.js'

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
        api_token: resolvedConfig.api_token
          ? resolvedConfig.api_token.substring(0, 6) + '...'
          : undefined,
        api_base_url: resolvedConfig.api_base_url,
        app_base_url: resolvedConfig.app_base_url,
        contact_channel: resolvedConfig.contact_channel,
      }

      // Mask bot token if present
      if (jsonOutput.contact_channel.slack?.bot_token) {
        jsonOutput.contact_channel.slack.bot_token =
          jsonOutput.contact_channel.slack.bot_token.substring(0, 6) + '...'
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
    const apiToken = resolvedConfig.api_token || '<not set>'

    console.log(
      `  API Token: ${apiToken === '<not set>' ? chalk.red(apiToken) : chalk.green('***set***')}`,
    )
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
      console.log(
        `    Bot Token: ${
          contactChannel.slack.bot_token ? chalk.green('***set***') : chalk.red('<not set>')
        }`,
      )
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
      console.log(chalk.red('  No contact channel configured'))
    }
    console.log('')

    // Show environment variables
    console.log(chalk.yellow('Environment Variables:'))
    const envVars = [
      'HUMANLAYER_API_TOKEN',
      'HUMANLAYER_API_BASE_URL',
      'HUMANLAYER_APP_URL',
      'HUMANLAYER_SLACK_CHANNEL',
      'HUMANLAYER_SLACK_BOT_TOKEN',
      'HUMANLAYER_SLACK_CONTEXT',
      'HUMANLAYER_SLACK_THREAD_TS',
      'HUMANLAYER_SLACK_BLOCKS',
      'HUMANLAYER_EMAIL_ADDRESS',
      'HUMANLAYER_EMAIL_CONTEXT',
      'XDG_CONFIG_HOME',
    ]

    envVars.forEach(envVar => {
      const value = process.env[envVar]
      if (value) {
        const displayValue = envVar.includes('TOKEN') ? '***set***' : value
        console.log(`  ${envVar}: ${chalk.green(displayValue)}`)
      } else {
        console.log(`  ${envVar}: ${chalk.gray('<not set>')}`)
      }
    })
  } catch (error) {
    console.error(chalk.red(`Error showing config: ${error}`))
    process.exit(1)
  }
}
