#!/usr/bin/env node

import { Command } from 'commander'
import { spawn } from 'child_process'
import { loginCommand } from './commands/login.js'
import { tuiCommand } from './commands/tui.js'
import { contactHumanCommand } from './commands/contactHuman.js'
import { configShowCommand } from './commands/configShow.js'
import { startDefaultMCPServer, startClaudeApprovalsMCPServer } from './mcp.js'
import { getDefaultConfigPath, resolveFullConfig } from './config.js'
import { getProject } from './hlClient.js'

const program = new Command()

async function authenticate(printSelectedProject: boolean = false) {
  const config = resolveFullConfig({})

  if (!config.api_token) {
    console.error('Error: No HumanLayer API token found.')
    process.exit(1)
  }

  try {
    const project = await getProject(config.api_base_url, config.api_token)
    if (printSelectedProject) {
      console.log(`Selected project: ${project.name}`)
    }
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

program.name('humanlayer').description('HumanLayer, but on your command-line.').version('0.4.0')

const UNPROTECTED_COMMANDS = ['config', 'login']

program.hook('preAction', async (thisCmd, actionCmd) => {
  // Get the full command path by traversing up the command hierarchy
  const getCommandPath = (cmd: Command): string[] => {
    const path: string[] = [cmd.name()];
    let parent = cmd.parent;
    while (parent && parent.name() !== 'humanlayer') {
      path.unshift(parent.name());
      parent = parent.parent;
    }
    return path;
  };

  const commandPath = getCommandPath(actionCmd);
  const isUnprotected = commandPath.some(cmd => UNPROTECTED_COMMANDS.includes(cmd));

  if (!isUnprotected) {
    console.log("Authenticating...")
    await authenticate(true);
  } 
})

// By default, we run the TUI.
program.action(() => {
  tuiCommand()
})

program
  .command('login')
  .description('Login to HumanLayer and save API token')
  .option('--api-base <url>', 'API base URL')
  .option('--app-base <url>', 'App base URL')
  .option('--config-file <path>', 'Path to config file')
  .action(loginCommand)

program.command('tui').description('Run the HumanLayer Terminal UI').action(tuiCommand)

program
  .command('config')
  .description('Configuration management')
  // config edit
  .command('edit')
    .description('Edit configuration file in $EDITOR')
    .option('--config-file <path>', 'Path to config file')
    .action((options) => {
      const editor = process.env.EDITOR || 'vi';
      const configFile = options.configFile || getDefaultConfigPath();
      spawn(editor, [configFile], { stdio: 'inherit' });
    })
  // config show
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
    const { spawn } = require('child_process')
    const args = ['@modelcontextprotocol/inspector', 'node', 'dist/index.js', 'mcp', command]
    spawn('npx', args, { stdio: 'inherit', cwd: process.cwd() })
  })

// Set up default action when no command is provided
program.action(() => {
  tuiCommand()
})

program.parse(process.argv)
