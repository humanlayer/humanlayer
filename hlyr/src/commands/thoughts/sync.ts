import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import {
  loadThoughtsConfig,
  getCurrentRepoPath,
  expandPath,
  updateSymlinksForNewUsers,
} from '../../thoughtsConfig.js'

interface SyncOptions {
  message?: string
  configFile?: string
}

function checkGitStatus(repoPath: string): boolean {
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe'
    })
    return status.trim().length > 0
  } catch {
    return false
  }
}

function syncThoughts(thoughtsRepo: string, message: string): void {
  const expandedRepo = expandPath(thoughtsRepo)

  try {
    // Stage all changes
    execSync('git add -A', { cwd: expandedRepo, stdio: 'pipe' })

    // Check if there are changes to commit
    const hasChanges = checkGitStatus(expandedRepo)

    if (!hasChanges) {
      console.log(chalk.gray('No changes to sync'))
      return
    }

    // Commit changes
    const commitMessage = message || `Sync thoughts - ${new Date().toISOString()}`
    execSync(`git commit -m "${commitMessage}"`, { cwd: expandedRepo, stdio: 'pipe' })

    console.log(chalk.green('✅ Thoughts synchronized'))

    // Check if remote exists
    try {
      execSync('git remote get-url origin', { cwd: expandedRepo, stdio: 'pipe' })

      // Try to push
      console.log(chalk.gray('Pushing to remote...'))
      try {
        execSync('git push', { cwd: expandedRepo, stdio: 'pipe' })
        console.log(chalk.green('✅ Pushed to remote'))
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not push to remote. You may need to push manually.'))
      }
    } catch {
      // No remote configured
      console.log(chalk.yellow('ℹ️  No remote configured for thoughts repository'))
    }
  } catch (error) {
    console.error(chalk.red(`Error syncing thoughts: ${error}`))
    process.exit(1)
  }
}

export async function thoughtsSyncCommand(options: SyncOptions): Promise<void> {
  try {
    // Check if thoughts are configured
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured. Run "humanlayer thoughts init" first.'))
      process.exit(1)
    }

    // Check if current repo has thoughts setup
    const currentRepo = getCurrentRepoPath()
    const thoughtsDir = path.join(currentRepo, 'thoughts')

    if (!fs.existsSync(thoughtsDir)) {
      console.error(chalk.red('Error: Thoughts not initialized for this repository.'))
      console.error('Run "humanlayer thoughts init" to set up thoughts.')
      process.exit(1)
    }

    // Get current repo mapping
    const mappedName = config.repoMappings[currentRepo]
    if (mappedName) {
      // Update symlinks for any new users
      const newUsers = updateSymlinksForNewUsers(
        currentRepo,
        config.thoughtsRepo,
        config.reposDir,
        mappedName,
        config.user
      )

      if (newUsers.length > 0) {
        console.log(chalk.green(`✓ Added symlinks for new users: ${newUsers.join(', ')}`))
      }
    }

    // Sync the thoughts repository
    console.log(chalk.blue('Syncing thoughts...'))
    syncThoughts(config.thoughtsRepo, options.message || '')

  } catch (error) {
    console.error(chalk.red(`Error during thoughts sync: ${error}`))
    process.exit(1)
  }
}
