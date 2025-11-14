import { Command } from 'commander'
import { thoughtsInitCommand } from './thoughts/init.js'
import { thoughtsUninitCommand } from './thoughts/uninit.js'
import { thoughtsSyncCommand } from './thoughts/sync.js'
import { thoughtsStatusCommand } from './thoughts/status.js'
import { thoughtsConfigCommand } from './thoughts/config.js'
import { profileCreateCommand } from './thoughts/profile/create.js'
import { profileListCommand } from './thoughts/profile/list.js'
import { profileShowCommand } from './thoughts/profile/show.js'
import { profileDeleteCommand } from './thoughts/profile/delete.js'

export function thoughtsCommand(program: Command): void {
  const thoughts = program.command('thoughts').description('Manage developer thoughts and notes')

  thoughts
    .command('init')
    .description('Initialize thoughts for current repository')
    .option('--force', 'Force reconfiguration even if already set up')
    .option('--config-file <path>', 'Path to config file')
    .option('--directory <name>', 'Specify the repository directory name (skips interactive prompt)')
    .option('--profile <name>', 'Use a specific thoughts profile')
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

  // Profile management commands
  const profile = thoughts.command('profile').description('Manage thoughts profiles')

  profile
    .command('create <name>')
    .description('Create a new thoughts profile')
    .option('--repo <path>', 'Thoughts repository path')
    .option('--repos-dir <name>', 'Repos directory name')
    .option('--global-dir <name>', 'Global directory name')
    .option('--config-file <path>', 'Path to config file')
    .action(profileCreateCommand)

  profile
    .command('list')
    .description('List all thoughts profiles')
    .option('--json', 'Output as JSON')
    .option('--config-file <path>', 'Path to config file')
    .action(profileListCommand)

  profile
    .command('show <name>')
    .description('Show details of a specific profile')
    .option('--json', 'Output as JSON')
    .option('--config-file <path>', 'Path to config file')
    .action(profileShowCommand)

  profile
    .command('delete <name>')
    .description('Delete a thoughts profile')
    .option('--force', 'Force deletion even if in use')
    .option('--config-file <path>', 'Path to config file')
    .action(profileDeleteCommand)
}
