import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { ConfigResolver, saveConfigFile } from './config.js'
import type { RepoMappingObject, ProfileConfig } from './config.js'

export interface ThoughtsConfig {
  thoughtsRepo: string
  reposDir: string // Directory name within thoughtsRepo (e.g., "repos")
  globalDir: string // Directory name within thoughtsRepo (e.g., "global")
  user: string
  repoMappings: Record<string, string | RepoMappingObject>
  profiles?: Record<string, ProfileConfig>
}

export interface ResolvedProfileConfig {
  thoughtsRepo: string
  reposDir: string
  globalDir: string
  profileName?: string // undefined for default config
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

// Overloaded signatures for ensureThoughtsRepoExists
export function ensureThoughtsRepoExists(config: ResolvedProfileConfig): void
export function ensureThoughtsRepoExists(
  thoughtsRepo: string,
  reposDir: string,
  globalDir: string,
): void
export function ensureThoughtsRepoExists(
  configOrThoughtsRepo: ResolvedProfileConfig | string,
  reposDir?: string,
  globalDir?: string,
): void {
  let thoughtsRepo: string
  let effectiveReposDir: string
  let effectiveGlobalDir: string

  if (typeof configOrThoughtsRepo === 'string') {
    // Legacy signature: (thoughtsRepo, reposDir, globalDir)
    thoughtsRepo = configOrThoughtsRepo
    effectiveReposDir = reposDir!
    effectiveGlobalDir = globalDir!
  } else {
    // New signature: (config)
    thoughtsRepo = configOrThoughtsRepo.thoughtsRepo
    effectiveReposDir = configOrThoughtsRepo.reposDir
    effectiveGlobalDir = configOrThoughtsRepo.globalDir
  }

  const expandedRepo = expandPath(thoughtsRepo)

  // Create thoughts repo if it doesn't exist
  if (!fs.existsSync(expandedRepo)) {
    fs.mkdirSync(expandedRepo, { recursive: true })
  }

  // Create subdirectories
  const expandedRepos = path.join(expandedRepo, effectiveReposDir)
  const expandedGlobal = path.join(expandedRepo, effectiveGlobalDir)

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

// Overloaded signatures for getRepoThoughtsPath
export function getRepoThoughtsPath(config: ResolvedProfileConfig, repoName: string): string
export function getRepoThoughtsPath(thoughtsRepo: string, reposDir: string, repoName: string): string
export function getRepoThoughtsPath(
  thoughtsRepoOrConfig: string | ResolvedProfileConfig,
  reposDirOrRepoName: string,
  repoName?: string,
): string {
  if (typeof thoughtsRepoOrConfig === 'string') {
    // Legacy signature: (thoughtsRepo, reposDir, repoName)
    return path.join(expandPath(thoughtsRepoOrConfig), reposDirOrRepoName, repoName!)
  }

  // New signature: (config, repoName)
  const config = thoughtsRepoOrConfig
  return path.join(expandPath(config.thoughtsRepo), config.reposDir, reposDirOrRepoName)
}

// Overloaded signatures for getGlobalThoughtsPath
export function getGlobalThoughtsPath(config: ResolvedProfileConfig): string
export function getGlobalThoughtsPath(thoughtsRepo: string, globalDir: string): string
export function getGlobalThoughtsPath(
  thoughtsRepoOrConfig: string | ResolvedProfileConfig,
  globalDir?: string,
): string {
  if (typeof thoughtsRepoOrConfig === 'string') {
    // Legacy signature: (thoughtsRepo, globalDir)
    return path.join(expandPath(thoughtsRepoOrConfig), globalDir!)
  }

  // New signature: (config)
  const config = thoughtsRepoOrConfig
  return path.join(expandPath(config.thoughtsRepo), config.globalDir)
}

export function getCurrentRepoPath(): string {
  return process.cwd()
}

export function getRepoNameFromPath(repoPath: string): string {
  // Extract a reasonable name from the repo path
  const parts = repoPath.split(path.sep)
  return parts[parts.length - 1] || 'unnamed_repo'
}

/**
 * Resolves the profile config for a given repository path
 * Returns default config if no profile specified or profile not found
 */
export function resolveProfileForRepo(config: ThoughtsConfig, repoPath: string): ResolvedProfileConfig {
  const mapping = config.repoMappings[repoPath]

  // Handle string format (legacy - no profile)
  if (typeof mapping === 'string') {
    return {
      thoughtsRepo: config.thoughtsRepo,
      reposDir: config.reposDir,
      globalDir: config.globalDir,
      profileName: undefined,
    }
  }

  // Handle object format
  if (mapping && typeof mapping === 'object') {
    const profileName = mapping.profile

    // If profile specified, look it up
    if (profileName && config.profiles && config.profiles[profileName]) {
      const profile = config.profiles[profileName]
      return {
        thoughtsRepo: profile.thoughtsRepo,
        reposDir: profile.reposDir,
        globalDir: profile.globalDir,
        profileName,
      }
    }

    // Object format but no profile or profile not found - use default
    return {
      thoughtsRepo: config.thoughtsRepo,
      reposDir: config.reposDir,
      globalDir: config.globalDir,
      profileName: undefined,
    }
  }

  // No mapping - use default
  return {
    thoughtsRepo: config.thoughtsRepo,
    reposDir: config.reposDir,
    globalDir: config.globalDir,
    profileName: undefined,
  }
}

/**
 * Gets the repo name from a mapping (handles both string and object formats)
 */
export function getRepoNameFromMapping(
  mapping: string | RepoMappingObject | undefined,
): string | undefined {
  if (!mapping) return undefined
  if (typeof mapping === 'string') return mapping
  return mapping.repo
}

/**
 * Gets the profile name from a mapping (returns undefined for string format)
 */
export function getProfileNameFromMapping(
  mapping: string | RepoMappingObject | undefined,
): string | undefined {
  if (!mapping) return undefined
  if (typeof mapping === 'string') return undefined
  return mapping.profile
}

/**
 * Validates that a profile exists in the configuration
 */
export function validateProfile(config: ThoughtsConfig, profileName: string): boolean {
  return !!(config.profiles && config.profiles[profileName])
}

/**
 * Sanitizes profile name (same rules as directory names)
 */
export function sanitizeProfileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// Overloaded signatures for createThoughtsDirectoryStructure
export function createThoughtsDirectoryStructure(
  config: ResolvedProfileConfig,
  repoName: string,
  user: string,
): void
export function createThoughtsDirectoryStructure(
  thoughtsRepo: string,
  reposDir: string,
  globalDir: string,
  repoName: string,
  user: string,
): void
export function createThoughtsDirectoryStructure(
  configOrThoughtsRepo: ResolvedProfileConfig | string,
  reposDirOrRepoName: string,
  globalDirOrUser: string,
  repoName?: string,
  user?: string,
): void {
  let resolvedConfig: { thoughtsRepo: string; reposDir: string; globalDir: string }
  let effectiveRepoName: string
  let effectiveUser: string

  if (typeof configOrThoughtsRepo === 'string') {
    // Legacy signature: (thoughtsRepo, reposDir, globalDir, repoName, user)
    resolvedConfig = {
      thoughtsRepo: configOrThoughtsRepo,
      reposDir: reposDirOrRepoName,
      globalDir: globalDirOrUser,
    }
    effectiveRepoName = repoName!
    effectiveUser = user!
  } else {
    // New signature: (config, repoName, user)
    resolvedConfig = configOrThoughtsRepo
    effectiveRepoName = reposDirOrRepoName
    effectiveUser = globalDirOrUser
  }

  // Create repo-specific directories
  const repoThoughtsPath = getRepoThoughtsPath(
    resolvedConfig.thoughtsRepo,
    resolvedConfig.reposDir,
    effectiveRepoName,
  )
  const repoUserPath = path.join(repoThoughtsPath, effectiveUser)
  const repoSharedPath = path.join(repoThoughtsPath, 'shared')

  // Create global directories
  const globalPath = getGlobalThoughtsPath(resolvedConfig.thoughtsRepo, resolvedConfig.globalDir)
  const globalUserPath = path.join(globalPath, effectiveUser)
  const globalSharedPath = path.join(globalPath, 'shared')

  // Create all directories
  for (const dir of [repoUserPath, repoSharedPath, globalUserPath, globalSharedPath]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // Create initial README files
  const repoReadme = `# ${effectiveRepoName} Thoughts

This directory contains thoughts and notes specific to the ${effectiveRepoName} repository.

- \`${effectiveUser}/\` - Your personal notes for this repository
- \`shared/\` - Team-shared notes for this repository
`

  const globalReadme = `# Global Thoughts

This directory contains thoughts and notes that apply across all repositories.

- \`${effectiveUser}/\` - Your personal cross-repository notes
- \`shared/\` - Team-shared cross-repository notes
`

  if (!fs.existsSync(path.join(repoThoughtsPath, 'README.md'))) {
    fs.writeFileSync(path.join(repoThoughtsPath, 'README.md'), repoReadme)
  }

  if (!fs.existsSync(path.join(globalPath, 'README.md'))) {
    fs.writeFileSync(path.join(globalPath, 'README.md'), globalReadme)
  }
}

// Overloaded signatures for updateSymlinksForNewUsers
export function updateSymlinksForNewUsers(
  currentRepoPath: string,
  config: ResolvedProfileConfig,
  repoName: string,
  currentUser: string,
): string[]
export function updateSymlinksForNewUsers(
  currentRepoPath: string,
  thoughtsRepo: string,
  reposDir: string,
  repoName: string,
  currentUser: string,
): string[]
export function updateSymlinksForNewUsers(
  currentRepoPath: string,
  configOrThoughtsRepo: ResolvedProfileConfig | string,
  reposDirOrRepoName: string,
  repoNameOrCurrentUser: string,
  currentUser?: string,
): string[] {
  let resolvedConfig: { thoughtsRepo: string; reposDir: string }
  let effectiveRepoName: string
  let effectiveUser: string

  if (typeof configOrThoughtsRepo === 'string') {
    // Legacy signature: (currentRepoPath, thoughtsRepo, reposDir, repoName, currentUser)
    resolvedConfig = {
      thoughtsRepo: configOrThoughtsRepo,
      reposDir: reposDirOrRepoName,
    }
    effectiveRepoName = repoNameOrCurrentUser
    effectiveUser = currentUser!
  } else {
    // New signature: (currentRepoPath, config, repoName, currentUser)
    resolvedConfig = configOrThoughtsRepo
    effectiveRepoName = reposDirOrRepoName
    effectiveUser = repoNameOrCurrentUser
  }

  const thoughtsDir = path.join(currentRepoPath, 'thoughts')
  const repoThoughtsPath = getRepoThoughtsPath(
    resolvedConfig.thoughtsRepo,
    resolvedConfig.reposDir,
    effectiveRepoName,
  )
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
    if (!fs.existsSync(symlinkPath) && userName !== effectiveUser) {
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
