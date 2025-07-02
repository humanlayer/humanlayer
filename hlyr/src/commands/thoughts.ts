import { Command } from 'commander'
import { thoughtsInitCommand } from './thoughts/init.js'
import { thoughtsUninitCommand } from './thoughts/uninit.js'
import { thoughtsSyncCommand } from './thoughts/sync.js'
import { thoughtsStatusCommand } from './thoughts/status.js'
import { thoughtsConfigCommand } from './thoughts/config.js'

export function thoughtsCommand(program: Command): void {
  const thoughts = program.command('thoughts').description('Manage developer thoughts and notes')

  thoughts
    .command('init')
    .description('Initialize thoughts for current repository')
    .option('--force', 'Force reconfiguration even if already set up')
    .option('--config-file <path>', 'Path to config file')
    .option('--directory <name>', 'Specify the repository directory name (skips interactive prompt)')
    .action(thoughtsInitCommand)

  thoughts
    .command('uninit')
    .description('Remove thoughts setup from current repository')
    .option('--force', 'Force removal even if not in configuration')
    .option('--config-file <path>', 'Path to config file')
    .action(thoughtsUninitCommand)

  thoughts
    .command('sync')
    .description('Manually sync thoughts to thoughts repository')
    .option('-m, --message <message>', 'Commit message for sync')
    .option('--config-file <path>', 'Path to config file')
    .action(thoughtsSyncCommand)

  thoughts
    .command('status')
    .description('Show status of thoughts repository')
    .option('--config-file <path>', 'Path to config file')
    .action(thoughtsStatusCommand)

  thoughts
    .command('config')
    .description('View or edit thoughts configuration')
    .option('--edit', 'Open configuration in editor')
    .option('--json', 'Output configuration as JSON')
    .option('--config-file <path>', 'Path to config file')
    .action(thoughtsConfigCommand)
}
