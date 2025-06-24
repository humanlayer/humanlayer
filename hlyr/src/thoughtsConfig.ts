import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { ConfigResolver, saveConfigFile } from './config.js'

export interface ThoughtsConfig {
  thoughtsRepo: string
  reposDir: string // Directory name within thoughtsRepo (e.g., "repos")
  globalDir: string // Directory name within thoughtsRepo (e.g., "global")
  user: string
  repoMappings: Record<string, string>
}

export function loadThoughtsConfig(options: Record<string, unknown> = {}): ThoughtsConfig | null {
  const resolver = new ConfigResolver(options)
  return resolver.configFile.thoughts || null
}

export function saveThoughtsConfig(
  thoughtsConfig: ThoughtsConfig,
  options: Record<string, unknown> = {},
): void {
  const resolver = new ConfigResolver(options)
  resolver.configFile.thoughts = thoughtsConfig
  saveConfigFile(resolver.configFile, options.configFile as string | undefined)
}

export function getDefaultThoughtsRepo(): string {
  return path.join(os.homedir(), 'thoughts')
}

export function expandPath(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2))
  }
  return path.resolve(filePath)
}

export function ensureThoughtsRepoExists(
  thoughtsRepo: string,
  reposDir: string,
  globalDir: string,
): void {
  const expandedRepo = expandPath(thoughtsRepo)

  // Create thoughts repo if it doesn't exist
  if (!fs.existsSync(expandedRepo)) {
    fs.mkdirSync(expandedRepo, { recursive: true })
  }

  // Create subdirectories
  const expandedRepos = path.join(expandedRepo, reposDir)
  const expandedGlobal = path.join(expandedRepo, globalDir)

  if (!fs.existsSync(expandedRepos)) {
    fs.mkdirSync(expandedRepos, { recursive: true })
  }

  if (!fs.existsSync(expandedGlobal)) {
    fs.mkdirSync(expandedGlobal, { recursive: true })
  }

  // Check if we're in a git repo (handle both .git directory and .git file for worktrees)
  const gitPath = path.join(expandedRepo, '.git')
  const isGitRepo =
    fs.existsSync(gitPath) && (fs.statSync(gitPath).isDirectory() || fs.statSync(gitPath).isFile())

  if (!isGitRepo) {
    // Initialize as git repo
    execSync('git init', { cwd: expandedRepo })

    // Create initial .gitignore
    const gitignore = `# OS files
.DS_Store
Thumbs.db

# Editor files
.vscode/
.idea/
*.swp
*.swo
*~

# Temporary files
*.tmp
*.bak
`
    fs.writeFileSync(path.join(expandedRepo, '.gitignore'), gitignore)

    // Initial commit
    execSync('git add .gitignore', { cwd: expandedRepo })
    execSync('git commit -m "Initial thoughts repository setup"', { cwd: expandedRepo })
  }
}

export function getRepoThoughtsPath(thoughtsRepo: string, reposDir: string, repoName: string): string {
  return path.join(expandPath(thoughtsRepo), reposDir, repoName)
}

export function getGlobalThoughtsPath(thoughtsRepo: string, globalDir: string): string {
  return path.join(expandPath(thoughtsRepo), globalDir)
}

export function getCurrentRepoPath(): string {
  return process.cwd()
}

export function getRepoNameFromPath(repoPath: string): string {
  // Extract a reasonable name from the repo path
  const parts = repoPath.split(path.sep)
  return parts[parts.length - 1] || 'unnamed_repo'
}

export function createThoughtsDirectoryStructure(
  thoughtsRepo: string,
  reposDir: string,
  globalDir: string,
  repoName: string,
  user: string,
): void {
  // Create repo-specific directories
  const repoThoughtsPath = getRepoThoughtsPath(thoughtsRepo, reposDir, repoName)
  const repoUserPath = path.join(repoThoughtsPath, user)
  const repoSharedPath = path.join(repoThoughtsPath, 'shared')

  // Create global directories
  const globalPath = getGlobalThoughtsPath(thoughtsRepo, globalDir)
  const globalUserPath = path.join(globalPath, user)
  const globalSharedPath = path.join(globalPath, 'shared')

  // Create all directories
  for (const dir of [repoUserPath, repoSharedPath, globalUserPath, globalSharedPath]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // Create initial README files
  const repoReadme = `# ${repoName} Thoughts

This directory contains thoughts and notes specific to the ${repoName} repository.

- \`${user}/\` - Your personal notes for this repository
- \`shared/\` - Team-shared notes for this repository
`

  const globalReadme = `# Global Thoughts

This directory contains thoughts and notes that apply across all repositories.

- \`${user}/\` - Your personal cross-repository notes
- \`shared/\` - Team-shared cross-repository notes
`

  if (!fs.existsSync(path.join(repoThoughtsPath, 'README.md'))) {
    fs.writeFileSync(path.join(repoThoughtsPath, 'README.md'), repoReadme)
  }

  if (!fs.existsSync(path.join(globalPath, 'README.md'))) {
    fs.writeFileSync(path.join(globalPath, 'README.md'), globalReadme)
  }
}

export function updateSymlinksForNewUsers(
  currentRepoPath: string,
  thoughtsRepo: string,
  reposDir: string,
  repoName: string,
  currentUser: string,
): string[] {
  const thoughtsDir = path.join(currentRepoPath, 'thoughts')
  const repoThoughtsPath = getRepoThoughtsPath(thoughtsRepo, reposDir, repoName)
  const addedSymlinks: string[] = []

  if (!fs.existsSync(thoughtsDir) || !fs.existsSync(repoThoughtsPath)) {
    return addedSymlinks
  }

  // Get all user directories in the repo thoughts
  const entries = fs.readdirSync(repoThoughtsPath, { withFileTypes: true })
  const userDirs = entries
    .filter(entry => entry.isDirectory() && entry.name !== 'shared' && !entry.name.startsWith('.'))
    .map(entry => entry.name)

  // Check each user directory and create symlinks if missing
  for (const userName of userDirs) {
    const symlinkPath = path.join(thoughtsDir, userName)
    const targetPath = path.join(repoThoughtsPath, userName)

    // Skip if symlink already exists or if it's the current user (already handled)
    if (!fs.existsSync(symlinkPath) && userName !== currentUser) {
      try {
        fs.symlinkSync(targetPath, symlinkPath, 'dir')
        addedSymlinks.push(userName)
      } catch {
        // Ignore errors - might be permission issues
      }
    }
  }

  return addedSymlinks
}
