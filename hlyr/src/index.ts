#!/usr/bin/env node

import { Command } from 'commander'
import { spawn } from 'child_process'
import { loginCommand } from './commands/login.js'
import { contactHumanCommand } from './commands/contactHuman.js'
import { configShowCommand } from './commands/configShow.js'
import { pingCommand } from './commands/ping.js'
import { launchCommand } from './commands/launch.js'
import { alertCommand } from './commands/alert.js'
import { thoughtsCommand } from './commands/thoughts.js'
import { joinWaitlistCommand } from './commands/joinWaitlist.js'
import { startDefaultMCPServer, startClaudeApprovalsMCPServer } from './mcp.js'
import {
  getDefaultConfigPath,
  resolveFullConfig,
  resolveConfigWithSources,
  maskSensitiveValue,
} from './config.js'
import { getProject } from './hlClient.js'
import chalk from 'chalk'

// Version is injected at build time by tsup
const VERSION = process.env.PACKAGE_VERSION || '0.11.0'

function showAbbreviatedConfig() {
  const configWithSources = resolveConfigWithSources({})
  console.log(`\n${chalk.yellow('Current configuration:')}`)
  console.log(
    `  API Base URL: ${chalk.cyan(configWithSources.api_base_url.value)} ${chalk.gray(
      `(${configWithSources.api_base_url.sourceName})`,
    )}`,
  )
  console.log(
    `  App Base URL: ${chalk.cyan(configWithSources.app_base_url.value)} ${chalk.gray(
      `(${configWithSources.app_base_url.sourceName})`,
    )}`,
  )
  const apiKeyDisplay = configWithSources.api_key?.value
    ? chalk.green(maskSensitiveValue(configWithSources.api_key.value))
    : chalk.red(maskSensitiveValue(undefined))
  console.log(`  API Key: ${apiKeyDisplay} ${chalk.gray(`(${configWithSources.api_key?.sourceName})`)}`)
}

const program = new Command()

async function authenticate(printSelectedProject: boolean = false) {
  const config = resolveFullConfig({})

  if (!config.api_key) {
    console.error('Error: No HumanLayer API token found.')
    showAbbreviatedConfig()
    process.exit(1)
  }

  try {
    await getProject(config.api_base_url, config.api_key)
    if (printSelectedProject) {
      // Project authenticated successfully
    }
  } catch (error) {
    console.error(chalk.red('Authentication failed:'), error)
    showAbbreviatedConfig()
    process.exit(1)
  }
}

program.name('humanlayer').description('HumanLayer, but on your command-line.').version(VERSION)

const UNPROTECTED_COMMANDS = ['config', 'login', 'thoughts', 'join-waitlist', 'launch', 'mcp']

program.hook('preAction', async (thisCmd, actionCmd) => {
  // Get the full command path by traversing up the command hierarchy
  const getCommandPath = (cmd: Command): string[] => {
    const path: string[] = [cmd.name()]
    let parent = cmd.parent
    while (parent && parent.name() !== 'humanlayer') {
      path.unshift(parent.name())
      parent = parent.parent
    }
    return path
  }

  const commandPath = getCommandPath(actionCmd)
  const isUnprotected = commandPath.some(cmd => UNPROTECTED_COMMANDS.includes(cmd))

  if (!isUnprotected) {
    await authenticate(true)
  }
})

program
  .command('login')
  .description('Login to HumanLayer and save API token')
  .option('--api-base <url>', 'API base URL')
  .option('--app-base <url>', 'App base URL')
  .option('--config-file <path>', 'Path to config file')
  .action(loginCommand)

program
  .command('launch <query>')
  .description('Launch a new Claude Code session via the daemon')
  .option('-m, --model <model>', 'Model to use (opus or sonnet)', 'sonnet')
  .option('-w, --working-dir <path>', 'Working directory for the session')
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

program
  .command('ping')
  .description('Check authentication and display current project')
  .action(pingCommand)

program
  .command('alert')
  .description('Monitor daemon for new approval alerts with audio notifications')
  .option('--event-types <types...>', 'Event types to watch (default: new_approval)')
  .option('--session-id <id>', 'Filter by session ID')
  .option('--run-id <id>', 'Filter by run ID')
  .option('--sound-file <path>', 'Custom sound file to play on alerts')
  .option('--quiet', 'Disable sound notifications')
  .option('--daemon-socket <path>', 'Path to daemon socket')
  .action(alertCommand)

const mcpCommand = program.command('mcp').description('MCP server functionality')

mcpCommand
  .command('serve')
  .description('Start the default MCP server for contact_human functionality')
  .action(startDefaultMCPServer)

mcpCommand
  .command('claude_approvals')
  .description('Start the Claude approvals MCP server for permission requests')
  .action(startClaudeApprovalsMCPServer)

mcpCommand
  .command('wrapper')
  .description('Wrap an existing MCP server with human approval functionality (not implemented yet)')
  .action(() => {
    console.log('MCP wrapper functionality is not implemented yet.')
    console.log('This will allow wrapping any existing MCP server with human approval.')
    process.exit(1)
  })

mcpCommand
  .command('inspector')
  .description('Run MCP inspector for debugging MCP servers')
  .argument('[command]', 'MCP server command to inspect', 'serve')
  .action(command => {
    const args = ['@modelcontextprotocol/inspector', 'node', 'dist/index.js', 'mcp', command]
    spawn('npx', args, { stdio: 'inherit', cwd: process.cwd() })
  })

// Add thoughts command
thoughtsCommand(program)

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

program.parse(process.argv)
