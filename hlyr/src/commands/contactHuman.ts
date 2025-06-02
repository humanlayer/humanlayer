import chalk from 'chalk'
import { humanlayer } from '@humanlayer/sdk'
import { resolveFullConfig } from '../config.js'

interface ContactHumanOptions {
  message: string
  configFile?: string
  slackChannel?: string
  slackBotToken?: string
  slackContext?: string
  slackThreadTs?: string
  slackBlocks?: boolean
  emailAddress?: string
  emailContext?: string
}

export async function contactHumanCommand(options: ContactHumanOptions) {
  let message = options.message

  if (message === '-') {
    // Read from stdin
    process.stdin.setEncoding('utf8')
    let stdinData = ''

    for await (const chunk of process.stdin) {
      stdinData += chunk
    }

    message = stdinData.trim()
  }

  try {
    const resolvedConfig = resolveFullConfig(options)

    // Use contact channel if configured, otherwise default to web UI
    const hl =
      Object.keys(resolvedConfig.contact_channel).length > 0
        ? humanlayer({
            contactChannel: resolvedConfig.contact_channel,
            ...(resolvedConfig.run_id && { runId: resolvedConfig.run_id }),
          })
        : humanlayer({
            apiKey: resolvedConfig.api_key,
            apiBaseUrl: resolvedConfig.api_base_url,
            ...(resolvedConfig.run_id && { runId: resolvedConfig.run_id }),
          })

    console.error(chalk.yellow('Contacting human...'))

    const response = await hl.fetchHumanResponse({
      spec: {
        msg: message,
      },
    })

    console.error(chalk.green('Human response received'))
    console.log(response)
  } catch (error) {
    console.error(chalk.red('Error contacting human:'), error)
    process.exit(1)
  }
}
