import { Command } from 'commander'
import { opencodeInitCommand } from './opencode/init.js'

export function opencodeCommand(program: Command): void {
  const opencode = program.command('opencode').description('Manage OpenCode configuration')

  opencode
    .command('init')
    .description('Initialize OpenCode configuration in current directory')
    .option('--force', 'Force overwrite of existing .opencode directory')
    .option('--all', 'Copy all files without prompting')
    .option('--model <model>', 'Default model in provider/model format (e.g., anthropic/claude-sonnet-4-20250514)')
    .action(opencodeInitCommand)
}
