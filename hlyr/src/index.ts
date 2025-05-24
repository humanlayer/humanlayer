#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'
import { humanlayer } from 'humanlayer'
import { loadConfigFile, buildContactChannel } from './config.js'
import { loginCommand } from './commands/login.js'

const program = new Command()

program.name('hlyr').description('HumanLayer, but on your command-line.').version('0.1.0')

program
  .command('login')
  .description('Login to HumanLayer and save API token')
  .option('--api-base <url>', 'API base URL', 'https://api.humanlayer.dev')
  .action(loginCommand)

program
  .command('contact_human')
  .description('Contact a human with a message')
  .requiredOption('-m, --message <text>', 'The message to send (use "-" to read from stdin)')
  .option('--slack-channel <id>', 'Slack channel or user ID')
  .option('--slack-bot-token <token>', 'Slack bot token')
  .option('--slack-context <context>', 'Context about the Slack channel or user')
  .option('--slack-thread-ts <ts>', 'Slack thread timestamp')
  .option('--slack-blocks [boolean]', 'Use experimental Slack blocks', true)
  .option('--email-address <email>', 'Email address to contact')
  .option('--email-context <context>', 'Context about the email recipient')
  .action(async options => {
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
  })

program.parse(process.argv)
