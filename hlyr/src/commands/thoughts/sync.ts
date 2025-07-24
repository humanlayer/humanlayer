import fs from 'fs'
import path from 'path'
import { execSync, execFileSync } from 'child_process'
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
      stdio: 'pipe',
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

    if (hasChanges) {
      // Commit changes
      const commitMessage = message || `Sync thoughts - ${new Date().toISOString()}`
      execFileSync('git', ['commit', '-m', commitMessage], { cwd: expandedRepo, stdio: 'pipe' })

      console.log(chalk.green('✅ Thoughts synchronized'))
    } else {
      console.log(chalk.gray('No changes to commit'))
    }

    // Pull latest changes after committing (to avoid conflicts with staged changes)
    try {
      execSync('git pull --rebase', {
        stdio: 'pipe',
        cwd: expandedRepo,
      })
    } catch (error) {
      const errorStr = error.toString()
      if (
        errorStr.includes('CONFLICT (') ||
        errorStr.includes('Automatic merge failed') ||
        errorStr.includes('Patch failed at') ||
        errorStr.includes('When you have resolved this problem, run "git rebase --continue"')
      ) {
        console.error(chalk.red('Error: Merge conflict detected in thoughts repository'))
        console.error(chalk.red('Please resolve conflicts manually in:'), expandedRepo)
        console.error(
          chalk.red('Then run "git rebase --continue" and "humanlayer thoughts sync" again'),
        )
        process.exit(1)
      } else {
        // If pull fails for other reasons, show warning but continue
        // This handles cases like no upstream, network issues, etc.
        console.warn(chalk.yellow('Warning: Could not pull latest changes:'), error.message)
      }
    }

    // Check if remote exists and push any unpushed commits
    try {
      execSync('git remote get-url origin', { cwd: expandedRepo, stdio: 'pipe' })

      // Try to push
      console.log(chalk.gray('Pushing to remote...'))
      try {
        execSync('git push', { cwd: expandedRepo, stdio: 'pipe' })
        console.log(chalk.green('✅ Pushed to remote'))
      } catch {
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

function createSearchDirectory(thoughtsDir: string): void {
  const searchDir = path.join(thoughtsDir, 'searchable')
  const oldSearchDir = path.join(thoughtsDir, '.search')

  // Remove old .search directory if it exists
  if (fs.existsSync(oldSearchDir)) {
    try {
      execSync(`chmod -R 755 "${oldSearchDir}"`, { stdio: 'pipe' })
    } catch {
      // Ignore chmod errors
    }
    fs.rmSync(oldSearchDir, { recursive: true, force: true })
  }

  // Remove existing searchable directory if it exists
  if (fs.existsSync(searchDir)) {
    try {
      // Reset permissions so we can delete it
      execSync(`chmod -R 755 "${searchDir}"`, { stdio: 'pipe' })
    } catch {
      // Ignore chmod errors
    }
    fs.rmSync(searchDir, { recursive: true, force: true })
  }

  // Create new .search directory
  fs.mkdirSync(searchDir, { recursive: true })

  // Function to recursively find all files through symlinks
  function findFilesFollowingSymlinks(
    dir: string,
    baseDir: string = dir,
    visited: Set<string> = new Set(),
  ): string[] {
    const files: string[] = []

    // Resolve symlinks to avoid cycles
    const realPath = fs.realpathSync(dir)
    if (visited.has(realPath)) {
      return files
    }
    visited.add(realPath)

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...findFilesFollowingSymlinks(fullPath, baseDir, visited))
      } else if (entry.isSymbolicLink() && !entry.name.startsWith('.')) {
        try {
          const stat = fs.statSync(fullPath)
          if (stat.isDirectory()) {
            files.push(...findFilesFollowingSymlinks(fullPath, baseDir, visited))
          } else if (stat.isFile() && path.basename(fullPath) !== 'CLAUDE.md') {
            files.push(path.relative(baseDir, fullPath))
          }
        } catch {
          // Ignore broken symlinks
        }
      } else if (entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'CLAUDE.md') {
        files.push(path.relative(baseDir, fullPath))
      }
    }

    return files
  }

  // Get all files accessible through the thoughts directory (following symlinks)
  const allFiles = findFilesFollowingSymlinks(thoughtsDir)

  // Create hard links in .search directory
  let linkedCount = 0
  for (const relPath of allFiles) {
    const sourcePath = path.join(thoughtsDir, relPath)
    const targetPath = path.join(searchDir, relPath)

    // Create directory structure
    const targetDir = path.dirname(targetPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    try {
      // Resolve symlink to get the real file path
      const realSourcePath = fs.realpathSync(sourcePath)
      // Create hard link to the real file
      fs.linkSync(realSourcePath, targetPath)
      linkedCount++
    } catch {
      // Silently skip files we can't link (e.g., different filesystems)
    }
  }

  console.log(chalk.gray(`Created ${linkedCount} hard links in searchable directory`))
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
        config.user,
      )

      if (newUsers.length > 0) {
        console.log(chalk.green(`✓ Added symlinks for new users: ${newUsers.join(', ')}`))
      }
    }

    // Create .search directory with hard links
    console.log(chalk.blue('Creating searchable index...'))
    createSearchDirectory(thoughtsDir)

    // Sync the thoughts repository
    console.log(chalk.blue('Syncing thoughts...'))
    syncThoughts(config.thoughtsRepo, options.message || '')
  } catch (error) {
    console.error(chalk.red(`Error during thoughts sync: ${error}`))
    process.exit(1)
  }
}
