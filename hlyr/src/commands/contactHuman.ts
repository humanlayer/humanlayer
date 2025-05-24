import chalk from 'chalk'
import { humanlayer } from 'humanlayer'
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

    if (Object.keys(resolvedConfig.contact_channel).length === 0) {
      console.error(
        chalk.red(
          'Error: No contact channel configured. Please specify --slack-channel, --email-address, or use environment variables/config file.',
        ),
      )
      process.exit(1)
    }

    const hl = humanlayer({ contactChannel: resolvedConfig.contact_channel })

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
