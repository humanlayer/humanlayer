// Enable system CA certificates for self-signed TLS (e.g. Electric proxy)
process.env.NODE_USE_SYSTEM_CA ??= '1'

import 'zod/compile'
import { createCodelayerCommand } from '@humanlayer/codelayer'
import { Command } from 'commander'

import { registerApiCommand } from './api'
import { registerAgentsAuthCommands, registerFoldAuthCommands } from './commands/agents-auth'
import { automationRunCommand } from './commands/automation-run'
import { daemonLaunchCommand } from './commands/daemon-launch'
import { loginCommand } from './commands/login'
import { logoutCommand } from './commands/logout'
import { BUILD_VERSION, type EnvironmentName, resolveEnvironmentConfig } from './lib/macros'

const program = new Command()
	.name('humanlayer')
	.description('HumanLayer CLI — manage daemons and authentication')
	.version(BUILD_VERSION, '-v, --version', 'Display CLI version')
	.option('--beta', 'Use the beta environment (default until prod is available)')
	.option('--dev', 'Use the dev environment')
	.option('--local', 'Use local environment (localhost services)')

function getEnv(): EnvironmentName {
	const opts = program.opts<{ beta?: boolean; dev?: boolean; local?: boolean }>()
	if (opts.local) return 'local'
	if (opts.dev) return 'dev'
	if (opts.beta) return 'beta'
	return 'prod'
}

program
	.command('login')
	.alias('auth')
	.description('Authenticate with WorkOS browser login, falling back to device authorization')
	.action(() => {
		const envName = getEnv()
		const envConfig = resolveEnvironmentConfig(envName)
		return loginCommand(envName, envConfig)
	})

program
	.command('logout')
	.description('Clear stored credentials')
	.action(() => {
		const envName = getEnv()
		return logoutCommand(envName)
	})

const daemon = program.command('daemon').description('Manage riptide daemons')

daemon
	.command('launch')
	.description('Launch the daemon in the foreground')
	.option('--token <token>', 'Daemon auth token (skip auth flow)')
	.option('--launch-token <token>', 'Launch token for non-interactive environments')
	.option('--no-self-update', 'Refuse in-app updates (also HUMANLAYER_DISABLE_SELF_UPDATE=1)')
	.action((options: { token?: string; launchToken?: string; selfUpdate?: boolean }) => {
		const envName = getEnv()
		const envConfig = resolveEnvironmentConfig(envName)
		return daemonLaunchCommand(envName, envConfig, options)
	})

const automation = program.command('automation').description('Run bounded task automation')

automation
	.command('run')
	.description('Prepare and run one Cloud-visible session in the current checkout')
	.requiredOption('--pat <value>', 'HumanLayer personal access token')
	.option('--ensure-task <slug>', 'Use an active task by slug, creating it when absent')
	.option('--use-task <id-or-slug>', 'Use an existing task by ID or slug')
	.option('--task-name <name>', 'Task name required when ensuring a task')
	.requiredOption('--session-name <name>', 'Name for the new session')
	.option('--prompt <text>', 'Initial prompt text')
	.option('--prompt-file <path>', 'Path to a file containing the initial prompt')
	.option('--coding-agent <agent>', 'Coding agent: claude or codelayer', 'codelayer')
	.option('-p, --provider <provider>', 'Provider: anthropic, openai, codex, copilot, firepass', 'anthropic')
	.option('-m, --model <model>', 'Model ID (defaults per provider)')
	.option('--thinking <value>', 'Reasoning/thinking effort: low, medium, high, xhigh, max')
	.option('--metadata-file <path>', 'Write the prepared task and session IDs as JSON')
	.option('--shutdown-on <mode>', 'Shutdown mode: inactivity or stop', 'inactivity')
	.option('--inactivity <duration>', 'Inactivity window, for example 2m', '2m')
	.option('--on-failure <mode>', 'Failure mode: inactivity or stop', 'inactivity')
	.action(async (options) => {
		const envName = getEnv()
		const envConfig = resolveEnvironmentConfig(envName)
		const exitCode = await automationRunCommand(envName, envConfig, options)
		process.exit(exitCode)
	})

registerApiCommand(program, getEnv)

const agents = program.command('agents').description('Manage AI agents and providers')
registerAgentsAuthCommands(agents)
registerFoldAuthCommands(program)

program.addCommand(createCodelayerCommand())

program.parse(process.argv)
