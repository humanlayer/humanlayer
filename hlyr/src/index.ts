#!/usr/bin/env node

import { Command } from 'commander'
import { loginCommand } from './commands/login.js'
import { tuiCommand } from './commands/tui.js'
import { contactHumanCommand } from './commands/contactHuman.js'

const program = new Command()

program.name('humanlayer').description('HumanLayer, but on your command-line.').version('0.4.0')

program
  .command('login')
  .description('Login to HumanLayer and save API token')
  .option('--api-base <url>', 'API base URL', 'https://api.humanlayer.dev')
  .action(loginCommand)

program.command('tui').description('Run the HumanLayer Terminal UI').action(tuiCommand)

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
  .action(contactHumanCommand)

program.parse(process.argv)
