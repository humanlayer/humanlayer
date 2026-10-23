#!/usr/bin/env node

import { Command } from 'commander'

import { autoadvanceCommand } from './commands/autoadvance'
import { configCommand } from './commands/config'
import { initCommand } from './commands/init'
import { permalinkCommand } from './commands/permalink'
import { statusCommand } from './commands/status'
import { syncCommand } from './commands/sync'
import { tasksCommand } from './commands/tasks'
import { uninitCommand } from './commands/uninit'
import { BUILD_VERSION, COMMIT_HASH } from './config/macros'

const buildVersion = await BUILD_VERSION
const program = new Command()

program
	.name('rpi')
	.description('Research-Plan-Implement workflow CLI')
	.version(`${buildVersion} (${COMMIT_HASH})`)
	.enablePositionalOptions()
	.showHelpAfterError()

program
	.command('init')
	.description('Initialize RPI for the current repository')
	.option('--force', 'Force re-initialization')
	.option('--local <path>', 'Local path for artifacts repository')
	.option('--upstream <repo>', 'GitHub repo (org/name) to create or clone')
	.option('--host <hostname>', 'GitHub hostname for Enterprise (default: github.com)')
	.option('--config-file <path>', 'Use a specific config file')
	.option('--collection <name>', 'Collection to use for this directory')
	.action(initCommand)

program
	.command('sync')
	.description('Sync RPI changes to git repository')
	.option('-m, --message <msg>', 'Commit message')
	.option('--config-file <path>', 'Use a specific config file')
	.action(syncCommand)

program
	.command('status')
	.description('Show RPI repository status')
	.option('--config-file <path>', 'Use a specific config file')
	.action(statusCommand)

program
	.command('config')
	.description('Show or edit RPI configuration')
	.option('--edit', 'Edit the configuration file')
	.option('--json', 'Output configuration as JSON')
	.option('--get <key>', 'Get a specific configuration value')
	.option('--config-file <path>', 'Use a specific config file')
	.action(configCommand)

program
	.command('tasks')
	.description('List recent tasks')
	.option('--days <number>', 'Number of days to look back (default: 3)', '3')
	.option('--config-file <path>', 'Use a specific config file')
	.action(tasksCommand)

program
	.command('uninit')
	.description('Remove RPI setup from current repository')
	.option('--force', 'Force removal even if not in config')
	.option('--config-file <path>', 'Use a specific config file')
	.action(uninitCommand)

program
	.command('permalink <path>')
	.description('Generate GitHub permalink for RPI path (e.g., rpi/tasks/eng-1234)')
	.option('--config-file <path>', 'Use a specific config file')
	.action(permalinkCommand)

program
	.command('autoadvance')
	.description('PostToolUse hook handler - updates Linear ticket status based on RPI activity')
	.action(autoadvanceCommand)

program.parse()
