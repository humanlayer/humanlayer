import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { ContactChannel } from 'humanlayer'

// Load environment variables
dotenv.config()

export type ConfigFile = {
  slack?: {
    channel_or_user_id?: string
    context_about_channel_or_user?: string
    bot_token?: string
    experimental_slack_blocks?: boolean
    thread_ts?: string
  }
  email?: {
    address?: string
    context_about_user?: string
  }
}

export function loadConfigFile(): ConfigFile {
  const configPaths = [
    'humanlayer.json',
    path.join(process.env.HOME || '', 'humanlayer.json'),
    '/etc/humanlayer.json',
  ]

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

  return {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildContactChannel(options: any, config: ConfigFile) {
  // Priority: CLI flags > env vars > config file

  const slackChannelId =
    options.slackChannel ||
    process.env.HUMANLAYER_SLACK_CHANNEL ||
    config.slack?.channel_or_user_id ||
    ''

  const slackBotToken =
    options.slackBotToken || process.env.HUMANLAYER_SLACK_BOT_TOKEN || config.slack?.bot_token

  const slackContext =
    options.slackContext ||
    process.env.HUMANLAYER_SLACK_CONTEXT ||
    config.slack?.context_about_channel_or_user

  const slackThreadTs =
    options.slackThreadTs || process.env.HUMANLAYER_SLACK_THREAD_TS || config.slack?.thread_ts

  const slackBlocks =
    options.slackBlocks !== undefined
      ? options.slackBlocks
      : process.env.HUMANLAYER_SLACK_BLOCKS === 'true' ||
        config.slack?.experimental_slack_blocks ||
        true

  const emailAddress =
    options.emailAddress || process.env.HUMANLAYER_EMAIL_ADDRESS || config.email?.address

  const emailContext =
    options.emailContext || process.env.HUMANLAYER_EMAIL_CONTEXT || config.email?.context_about_user

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
