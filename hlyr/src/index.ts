#!/usr/bin/env node

import { Command } from 'commander'
import { spawn } from 'child_process'
import { configShowCommand } from './commands/configShow.js'
import { launchCommand } from './commands/launch.js'
import { thoughtsCommand } from './commands/thoughts.js'
import { claudeCommand } from './commands/claude.js'
import { opencodeCommand } from './commands/opencode.js'
import { joinWaitlistCommand } from './commands/joinWaitlist.js'
import { startClaudeApprovalsMCPServer } from './mcp.js'
import { getDefaultConfigPath } from './config.js'
import { getInvocationName, shouldLaunchApp, getAppPath, launchApp } from './utils/invocation.js'

// Version is injected at build time by tsup
const VERSION = process.env.PACKAGE_VERSION || '0.11.0'

const program = new Command()

// Determine the invocation name for dynamic behavior
const invocationName = getInvocationName()

program
  .name(
    invocationName === 'codelayer' || invocationName === 'codelayer-nightly'
      ? invocationName
      : 'humanlayer',
  )
  .description('HumanLayer, but on your command-line.')
  .version(VERSION)

const mcpCommand = program.command('mcp').description('MCP server functionality')

mcpCommand
  .command('claude_approvals')
  .description('Start the Claude approvals MCP server for permission requests')
  .action(startClaudeApprovalsMCPServer)

program
  .command('launch <query>')
  .description('Launch a new Claude Code session via the daemon')
  .option('-p, --provider <provider>', 'Provider to use (claude or opencode)', 'claude')
  .option('-m, --model <model>', 'Model to use (opus, sonnet, or haiku)', 'sonnet')
  .option('-t, --title <title>', 'Optional session title')
  .option('-w, --working-dir <path>', 'Working directory for the session')
  .option('--add-dir <directories...>', 'Additional directories Claude can access')
  .option('--max-turns <number>', 'Maximum number of turns', parseInt)
  .option('--no-approvals', 'Disable HumanLayer approvals for high-stakes operations')
  .option(
    '--dangerously-skip-permissions',
    'Enable dangerous skip permissions mode (bypasses all approval requirements)',
  )
  .option(
    '--dangerously-skip-permissions-timeout <minutes>',
    'Dangerously skip permissions timeout in minutes',
  )
  .option('--daemon-socket <path>', 'Path to daemon socket')
  .option('--config-file <path>', 'Path to config file')
  .action(launchCommand)

const configCommand = program.command('config').description('Configuration management')

configCommand
  .command('edit')
  .description('Edit configuration file in $EDITOR')
  .option('--config-file <path>', 'Path to config file')
  .action(options => {
    const editor = process.env.EDITOR || 'vi'
    const configFile = options.configFile || getDefaultConfigPath()
    spawn(editor, [configFile], { stdio: 'inherit' })
  })

configCommand
  .command('show')
  .description('Show current configuration')
  .option('--config-file <path>', 'Path to config file')
  .option('--slack-channel <id>', 'Slack channel or user ID')
  .option('--slack-bot-token <token>', 'Slack bot token')
  .option('--slack-context <context>', 'Context about the Slack channel or user')
  .option('--slack-thread-ts <ts>', 'Slack thread timestamp')
  .option('--slack-blocks [boolean]', 'Use experimental Slack blocks')
  .option('--email-address <email>', 'Email address to contact')
  .option('--email-context <context>', 'Context about the email recipient')
  .option('--json', 'Output as JSON with masked keys')
  .action(configShowCommand)

// Add thoughts command
thoughtsCommand(program)

// Add claude command
claudeCommand(program)

// Add opencode command
opencodeCommand(program)

// Add join-waitlist command
program
  .command('join-waitlist')
  .description('Join the HumanLayer Code early access waitlist')
  .requiredOption('--email <email>', 'Your email address')
  .action(joinWaitlistCommand)

// Handle unknown commands
program.on('command:*', operands => {
  console.error(`Unknown command: ${operands[0]}`)
  console.error('Run "humanlayer --help" for available commands')
  process.exit(1)
})

// Override the default error handling
program.configureOutput({
  writeErr: str => {
    if (str.includes('too many arguments')) {
      console.error('Unknown command')
      console.error('Run "humanlayer --help" for available commands')
      process.exit(1)
    } else {
      process.stderr.write(str)
    }
  },
})

// Check if we should launch the app instead of running CLI
const hasArgs = process.argv.length > 2 // More than just node/script name

if (shouldLaunchApp(invocationName, hasArgs)) {
  const appPath = getAppPath(invocationName)
  if (appPath) {
    launchApp(appPath)
    process.exit(0)
  } else {
    const appName = invocationName === 'codelayer-nightly' ? 'CodeLayer-Nightly' : 'CodeLayer'
    console.error(`${appName} app not found. Please install it first:`)
    console.error(
      `    brew install --cask humanlayer/humanlayer/${invocationName === 'codelayer-nightly' ? 'codelayer-nightly' : 'codelayer'}`,
    )
    process.exit(1)
  }
}

program.parse(process.argv)
