import { Command } from 'commander'
import { claudeInitCommand } from './claude/init.js'

export function claudeCommand(program: Command): void {
  const claude = program.command('claude').description('Manage Claude Code configuration')

  claude
    .command('init')
    .description('Initialize Claude Code configuration in current directory')
    .option('--force', 'Force overwrite of existing .claude directory')
    .option('--all', 'Copy all files without prompting')
    .action(claudeInitCommand)
}
