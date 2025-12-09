import { Command } from 'commander'
import { opencodeInitCommand } from './opencode/init.js'

export function opencodeCommand(program: Command): void {
	const opencode = program.command('opencode').description('Manage OpenCode configuration')

	opencode
		.command('init')
		.description('Initialize OpenCode configuration in current directory')
		.option('--force', 'Force overwrite of existing .opencode directory')
		.option('--all', 'Copy all files without prompting')
		// Accept but ignore thinking flags for CLI consistency
		.option('--always-thinking', '(Ignored - for CLI compatibility)')
		.option('--no-always-thinking', '(Ignored - for CLI compatibility)')
		.option('--max-thinking-tokens <number>', '(Ignored - for CLI compatibility)', (value) => parseInt(value, 10))
		.action(opencodeInitCommand)
}
