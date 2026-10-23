#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'

import { isCIMode } from './auth'
import { addComment } from './commands/addComment'
import { addLink } from './commands/addLink'
import { completionCommand } from './commands/completion'
import { createIssue } from './commands/createIssue'
import { deleteComment } from './commands/deleteComment'
import { ensureColumnsCommand } from './commands/ensureColumns'
import { ensureLink } from './commands/ensureLink'
import { fetchImages } from './commands/fetchImages'
import { getIssue } from './commands/getIssue'
import { getIssueV2 } from './commands/getIssueV2'
import { glass } from './commands/glass'
import { listIssues } from './commands/listIssues'
import { listIssuesV2 } from './commands/listIssuesV2'
import { listWorkflowStates } from './commands/listWorkflowStates'
import { login } from './commands/login'
import { logout } from './commands/logout'
import { updateStatus } from './commands/updateStatus'
import { uploadAttachment } from './commands/uploadAttachment'
import { BUILD_VERSION, COMMIT_HASH } from './config/macros'
import { needsAuthentication, initializeLinearClientAsync } from './utils/client'

async function main() {
	// Parse global options first to get --ci flag
	// We need to manually check for --ci before Commander parses
	const ciFlag = process.argv.includes('--ci')
	const effectiveCIMode = ciFlag || isCIMode()

	// Check if authentication is needed and initialize Linear client
	const needsAuth = needsAuthentication(process.argv)
	const linear = await initializeLinearClientAsync(needsAuth, { ciFlag })

	// If auth is needed but client couldn't be initialized, show error
	if (needsAuth && !linear) {
		if (effectiveCIMode) {
			console.error(chalk.red('Error: LINEAR_API_KEY environment variable is required in CI mode'))
			console.error(chalk.dim('Set LINEAR_API_KEY or remove --ci flag to use OAuth authentication'))
		} else {
			console.error(chalk.red('Error: Not authenticated'))
			console.error(chalk.yellow('Please run: linear login'))
			console.error(chalk.dim('Or set LINEAR_API_KEY environment variable for CI/CD'))
		}
		process.exit(1)
	}

	// Set up CLI
	const program = new Command()
	const buildVersion = await BUILD_VERSION

	program
		.name('linear')
		.description('Command line interface for Linear')
		.version(`${buildVersion} (${COMMIT_HASH})`)
		.option('--ci', 'CI mode: require LINEAR_API_KEY, disable OAuth and stored tokens')
		.enablePositionalOptions()
		.showHelpAfterError()

	// Auth commands
	program
		.command('login')
		.description('Authenticate with Linear via OAuth')
		.action(() => login())

	program
		.command('logout')
		.description('Log out and clear stored credentials')
		.action(() => logout())

	// Commands
	program
		.command('my-issues')
		.description('List your assigned issues')
		.action(() => listIssues(linear))

	program
		.command('get-issue [id]')
		.description('Show issue details and comments (ID optional if in git branch)')
		.action((id) => getIssue(linear, id))

	program
		.command('get-issue-v2 <id>')
		.description('Get a single issue with the same output format as list-issues')
		.option('--output-format <format>', 'Output format: markdown, json (compact), or rich-json (pretty)', 'json')
		.option(
			'--fields <fields>',
			'Comma-separated fields to include: identifier,title,branch,assignee,description,comments,parents',
			'identifier,title,branch',
		)
		.action((id, options) => getIssueV2(linear, id, options))

	program
		.command('add-comment <message>')
		.description('Add a comment to an issue (auto-detects issue ID from git branch)')
		.option('-i, --issue-id <id>', 'Specify the Linear issue ID manually')
		.action((message, options) => addComment(linear, message, options))

	program
		.command('delete-comment <commentId>')
		.description('Delete a comment by its ID')
		.action((commentId) => deleteComment(linear, commentId))

	program
		.command('fetch-images <id>')
		.description('Download all images from an issue to thoughts/shared/images/{ISSUE_ID}/')
		.action((id) => fetchImages(id))

	program
		.command('update-status <id> <status>')
		.description('Update the status of a Linear issue')
		.action((id, status) => updateStatus(linear, id, status))

	program
		.command('add-link <id> <url>')
		.description('Add a link/attachment to a Linear issue')
		.option('-t, --title <title>', 'Optional title for the link')
		.action((id, url, options) => addLink(linear, id, url, options))

	program
		.command('ensure-link <id> <url>')
		.description('Ensure a link attachment exists on a Linear issue (idempotent)')
		.option('-t, --title <title>', 'Optional title for the link')
		.action((id, url, options) => ensureLink(linear, id, url, options))

	program
		.command('upload-attachment <id> <file>')
		.description('Upload a local file as an attachment on a Linear issue')
		.option('-t, --title <title>', 'Optional title for the attachment (defaults to filename)')
		.option('-c, --content-type <contentType>', 'Override the detected content type')
		.action((id, file, options) => uploadAttachment(linear, id, file, options))

	program
		.command('list-issues')
		.description('List and filter issues with advanced options')
		.option('--max-issues <number>', 'Maximum number of issues to fetch', '10')
		.option('--team <team>', "Filter by team key (e.g. 'ENG', 'LL')")
		.option('--assignee <assignee>', 'Filter by assignee (name, email, or display name)')
		.option('--status <statuses>', "Filter by status (comma-separated, e.g. 'ready-for-questions,in-review')")
		.option('--size <sizes>', "Filter by issue size (comma-separated numbers, e.g. '1,2')")
		.option('--sort-asc', 'Sort by updatedAt in ascending order (default is descending)')
		.option(
			'--output-format <format>',
			'Output format: markdown, json (compact), or rich-json (pretty)',
			'markdown',
		)
		.option(
			'--fields <fields>',
			'Comma-separated fields to include: identifier,title,branch,assignee,description,comments',
			'identifier,title,branch',
		)
		.option('--ids-only', 'Output only issue identifiers (incompatible with --fields)')
		.option('--skip-if-last-comment-by <name>', 'Exclude issues where last comment is by specified author')
		.action((options) => listIssuesV2(linear, options))

	program
		.command('list-workflow-states <team>')
		.description('List workflow states for a team (e.g., ENG, LL)')
		.option('--output-format <format>', 'Output format: markdown or json', 'markdown')
		.action((team, options) => listWorkflowStates(linear, team, options))

	program
		.command('completion')
		.description('Generate shell completion script')
		.option('--bash', 'Generate Bash completion script')
		.option('--zsh', 'Generate Zsh completion script')
		.option('--fish', 'Generate Fish completion script')
		.action(completionCommand)

	program
		.command('ensure-columns <team> [config]')
		.description('Ensure workflow state columns exist for a team (creates missing, updates changed)')
		.option('--force', 'Skip confirmation prompt')
		.option('--dry-run', 'Show plan without making changes')
		.option('--destroy', 'Archive all columns specified in the config')
		.option('--remove-other-columns', "Also archive 'started' columns not in the config")
		.option('--use-rpi-defaults', 'Use built-in RPI workflow columns (18 states) instead of config file')
		.action((team, config, options) => ensureColumnsCommand(linear, team, config, options))

	program
		.command('glass <id>')
		.description("Reset issue: set status to 'Ready for Questions', remove assistant comments and attachments")
		.action((id) => glass(linear, id))

	program
		.command('create-issue')
		.description('Create a new Linear issue')
		.requiredOption('-t, --title <title>', 'Issue title')
		.requiredOption('-b, --body <body>', 'Issue body/description')
		.option('--team <key>', 'Team key (e.g., ENG, CORE)')
		.option('-s, --status <status>', 'Issue status (default: Triage)')
		.action((options) => createIssue(linear, options))

	program.parse(process.argv)

	// Show help if no command is provided
	if (process.argv.length <= 2) {
		program.help()
	}
}

main().catch((error) => {
	console.error(chalk.red('Fatal error:'), Error.isError(error) ? error.message : Bun.inspect(error))
	process.exit(1)
})
