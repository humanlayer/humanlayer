import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import chalk from 'chalk'
import { loadThoughtsConfig, getCurrentRepoPath, expandPath } from '../../thoughtsConfig.js'

function getGitStatus(repoPath: string): string {
  try {
    return execSync('git status -sb', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return 'Not a git repository'
  }
}

function getUncommittedChanges(repoPath: string): string[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const status = line.substring(0, 2)
        const file = line.substring(3)
        let statusText = ''

        if (status[0] === 'M' || status[1] === 'M') statusText = 'modified'
        else if (status[0] === 'A') statusText = 'added'
        else if (status[0] === 'D') statusText = 'deleted'
        else if (status[0] === '?') statusText = 'untracked'
        else if (status[0] === 'R') statusText = 'renamed'

        return `  ${chalk.yellow(statusText.padEnd(10))} ${file}`
      })
  } catch {
    return []
  }
}

function getLastCommit(repoPath: string): string {
  try {
    return execSync('git log -1 --pretty=format:"%h %s (%cr)"', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return 'No commits yet'
  }
}

function getRemoteStatus(repoPath: string): string {
  try {
    execSync('git remote get-url origin', { cwd: repoPath, stdio: 'pipe' })

    // Fetch to update remote refs
    try {
      execSync('git fetch', { cwd: repoPath, stdio: 'pipe' })
    } catch {
      // Fetch might fail, continue anyway
    }

    // Check if we're ahead/behind
    const status = execSync('git status -sb', {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    if (status.includes('ahead')) {
      const ahead = status.match(/ahead (\d+)/)?.[1] || '?'
      return chalk.yellow(`${ahead} commits ahead of remote`)
    } else if (status.includes('behind')) {
      const behind = status.match(/behind (\d+)/)?.[1] || '?'

      // Try to automatically pull if we're behind
      try {
        execSync('git pull --rebase', {
          stdio: 'pipe',
          cwd: repoPath,
        })
        console.log(chalk.green('✓ Automatically pulled latest changes'))

        // Re-check status after pull
        const newStatus = execSync('git status -sb', {
          encoding: 'utf8',
          cwd: repoPath,
          stdio: 'pipe',
        })

        if (newStatus.includes('behind')) {
          const newBehind = newStatus.match(/behind (\d+)/)?.[1] || '?'
          return chalk.yellow(`${newBehind} commits behind remote (after pull)`)
        } else {
          return chalk.green('Up to date with remote (after pull)')
        }
      } catch {
        // Silent fail - status is read-only operation
        return chalk.yellow(`${behind} commits behind remote`)
      }
    } else {
      return chalk.green('Up to date with remote')
    }
  } catch {
    return chalk.gray('No remote configured')
  }
}

interface StatusOptions {
  configFile?: string
}

export async function thoughtsStatusCommand(options: StatusOptions): Promise<void> {
  try {
    // Check if thoughts are configured
    const config = loadThoughtsConfig(options)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured. Run "humanlayer thoughts init" first.'))
      process.exit(1)
    }

    console.log(chalk.blue('Thoughts Repository Status'))
    console.log(chalk.gray('='.repeat(50)))
    console.log('')

    // Show configuration
    console.log(chalk.yellow('Configuration:'))
    console.log(`  Repository: ${chalk.cyan(config.thoughtsRepo)}`)
    console.log(`  Repos directory: ${chalk.cyan(config.reposDir)}`)
    console.log(`  Global directory: ${chalk.cyan(config.globalDir)}`)
    console.log(`  User: ${chalk.cyan(config.user)}`)
    console.log(`  Mapped repos: ${chalk.cyan(Object.keys(config.repoMappings).length)}`)
    console.log('')

    // Check current repo mapping
    const currentRepo = getCurrentRepoPath()
    const currentMapping = config.repoMappings[currentRepo]

    if (currentMapping) {
      console.log(chalk.yellow('Current Repository:'))
      console.log(`  Path: ${chalk.cyan(currentRepo)}`)
      console.log(`  Thoughts directory: ${chalk.cyan(`${config.reposDir}/${currentMapping}`)}`)

      const thoughtsDir = path.join(currentRepo, 'thoughts')
      if (fs.existsSync(thoughtsDir)) {
        console.log(`  Status: ${chalk.green('✓ Initialized')}`)
      } else {
        console.log(`  Status: ${chalk.red('✗ Not initialized')}`)
      }
    } else {
      console.log(chalk.yellow('Current repository not mapped to thoughts'))
    }
    console.log('')

    // Show thoughts repository git status
    const expandedRepo = expandPath(config.thoughtsRepo)

    console.log(chalk.yellow('Thoughts Repository Git Status:'))
    console.log(`  ${getGitStatus(expandedRepo)}`)
    console.log(`  Remote: ${getRemoteStatus(expandedRepo)}`)
    console.log(`  Last commit: ${getLastCommit(expandedRepo)}`)
    console.log('')

    // Show uncommitted changes
    const changes = getUncommittedChanges(expandedRepo)
    if (changes.length > 0) {
      console.log(chalk.yellow('Uncommitted changes:'))
      changes.forEach(change => console.log(change))
      console.log('')
      console.log(chalk.gray('Run "humanlayer thoughts sync" to commit these changes'))
    } else {
      console.log(chalk.green('✓ No uncommitted changes'))
    }
  } catch (error) {
    console.error(chalk.red(`Error checking thoughts status: ${error}`))
    process.exit(1)
  }
}
