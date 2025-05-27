import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { ContactChannel } from 'humanlayer'

// Load environment variables
dotenv.config()

export type ConfigFile = {
  channel: ContactChannel
  api_token?: string
  api_base_url?: string
  app_base_url?: string
}

export function loadConfigFile(configFile?: string): ConfigFile {
  if (configFile) {
    const configContent = fs.readFileSync(configFile, 'utf8')
    return JSON.parse(configContent)
  }

  // these do not merge today
  const configPaths = ['humanlayer.json', getDefaultConfigPath()]

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8')
        return JSON.parse(configContent)
      }
    } catch (error) {
      console.error(chalk.yellow(`Warning: Could not parse config file ${configPath}: ${error}`))
    }
  }

  return { channel: {} }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildContactChannel(options: any, config: ConfigFile) {
  // Priority: CLI flags > env vars > config file

  const channel = config.channel || {}

  const slackChannelId =
    options.slackChannel ||
    process.env.HUMANLAYER_SLACK_CHANNEL ||
    channel.slack?.channel_or_user_id ||
    ''

  const slackBotToken =
    options.slackBotToken || process.env.HUMANLAYER_SLACK_BOT_TOKEN || channel.slack?.bot_token

  const slackContext =
    options.slackContext ||
    process.env.HUMANLAYER_SLACK_CONTEXT ||
    channel.slack?.context_about_channel_or_user

  const slackThreadTs =
    options.slackThreadTs || process.env.HUMANLAYER_SLACK_THREAD_TS || channel.slack?.thread_ts

  const slackBlocks =
    options.slackBlocks !== undefined
      ? options.slackBlocks
      : process.env.HUMANLAYER_SLACK_BLOCKS === 'true' ||
        channel.slack?.experimental_slack_blocks ||
        true

  const emailAddress =
    options.emailAddress || process.env.HUMANLAYER_EMAIL_ADDRESS || channel.email?.address

  const emailContext =
    options.emailContext || process.env.HUMANLAYER_EMAIL_CONTEXT || channel.email?.context_about_user

  const contactChannel: ContactChannel = {}

  if (slackChannelId || slackBotToken) {
    contactChannel.slack = {
      channel_or_user_id: slackChannelId,
      experimental_slack_blocks: slackBlocks,
    }

    if (slackBotToken) contactChannel.slack.bot_token = slackBotToken
    if (slackContext) contactChannel.slack.context_about_channel_or_user = slackContext
    if (slackThreadTs) contactChannel.slack.thread_ts = slackThreadTs
  }

  if (emailAddress) {
    contactChannel.email = {
      address: emailAddress,
    }

    if (emailContext) contactChannel.email.context_about_user = emailContext
  }

  return contactChannel
}

export function saveConfigFile(config: ConfigFile, configFile?: string): void {
  const configPath = configFile || getDefaultConfigPath()

  console.log(chalk.yellow(`Writing config to ${configPath}`))

  // Create directory if it doesn't exist
  const configDir = path.dirname(configPath)
  fs.mkdirSync(configDir, { recursive: true })

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  console.log(chalk.green('Config saved successfully'))
}

export function getDefaultConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config')
  return path.join(xdgConfigHome, 'humanlayer', 'humanlayer.json')
}

export type ResolvedConfig = {
  api_token?: string
  api_base_url: string
  app_base_url: string
  contact_channel: ContactChannel
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveFullConfig(options: any): ResolvedConfig {
  const config = options.configFile ? loadConfigFile(options.configFile) : loadConfigFile()

  const api_token = process.env.HUMANLAYER_API_KEY || config.api_token 
  const api_base_url =
    process.env.HUMANLAYER_API_BASE_URL || config.api_base_url || 'https://api.humanlayer.dev'
  const app_base_url =
    process.env.HUMANLAYER_APP_URL || config.app_base_url || 'https://app.humanlayer.dev'
  const contact_channel = buildContactChannel(options, config)

  return {
    api_token,
    api_base_url,
    app_base_url,
    contact_channel,
  }
}
