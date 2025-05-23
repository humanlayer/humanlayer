#!/usr/bin/env node

import { Command } from 'commander'
import chalk from 'chalk'

const program = new Command()

program.name('hlyr').description('HumanLayer, but on your command-line.').version('0.1.0')

program
  .command('contact_human')
  .description('Contact a human with a message')
  .requiredOption('-m, --message <text>', 'The message to send')
  .action(options => {
    console.log(chalk.green(`Hello world, you passed in ${options.message}`))
  })

program.parse(process.argv)
