import { Command } from 'commander'
import { claudeInitCommand } from './claude/init.js'

export function claudeCommand(program: Command): void {
  const claude = program.command('claude').description('Manage Claude Code configuration')

  claude
    .command('init')
    .description('Initialize Claude Code configuration in current directory')
    .option('--force', 'Force overwrite of existing .claude directory')
    .option('--all', 'Copy all files without prompting')
    .option('--model <model>', 'Default model: haiku, sonnet, or opus (default: opus)')
    .option('--always-thinking', 'Enable always-on thinking mode (default: true)')
    .option('--no-always-thinking', 'Disable always-on thinking mode')
    .option(
      '--max-thinking-tokens <number>',
      'Maximum thinking tokens (default: 32000)',
      value => parseInt(value, 10),
    )
    .action(claudeInitCommand)
}
