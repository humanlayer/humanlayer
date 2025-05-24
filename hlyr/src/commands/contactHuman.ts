import chalk from 'chalk'
import { humanlayer } from 'humanlayer'
import { loadConfigFile, buildContactChannel } from '../config.js'

export async function contactHumanCommand(options: any) {
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
    const config = loadConfigFile()
    const contactChannel = buildContactChannel(options, config)

    if (Object.keys(contactChannel).length === 0) {
      console.error(
        chalk.red(
          'Error: No contact channel configured. Please specify --slack-channel, --email-address, or use environment variables/config file.',
        ),
      )
      process.exit(1)
    }

    const hl = humanlayer({ contactChannel })

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
