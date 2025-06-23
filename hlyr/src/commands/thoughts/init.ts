import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import chalk from 'chalk'
import readline from 'readline'
import {
  ThoughtsConfig,
  loadThoughtsConfig,
  saveThoughtsConfig,
  getDefaultThoughtsRepo,
  ensureThoughtsRepoExists,
  createThoughtsDirectoryStructure,
  getCurrentRepoPath,
  getRepoNameFromPath,
  expandPath,
  getRepoThoughtsPath,
  getGlobalThoughtsPath,
  updateSymlinksForNewUsers,
} from '../../thoughtsConfig.js'

interface InitOptions {
  force?: boolean
  configFile?: string
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function checkExistingSetup(config?: ThoughtsConfig | null): { exists: boolean; isValid: boolean; isOldStructure?: boolean; message?: string } {
  const thoughtsDir = path.join(process.cwd(), 'thoughts')
  
  if (!fs.existsSync(thoughtsDir)) {
    return { exists: false, isValid: false }
  }
  
  // Check if it's a directory
  if (!fs.lstatSync(thoughtsDir).isDirectory()) {
    return { exists: true, isValid: false, message: 'thoughts exists but is not a directory' }
  }
  
  // Check for old structure (local/ and global/ directories)
  const localPath = path.join(thoughtsDir, 'local')
  const hasOldLocal = fs.existsSync(localPath) && fs.lstatSync(localPath).isSymbolicLink()
  
  if (hasOldLocal) {
    return { exists: true, isValid: false, isOldStructure: true, message: 'thoughts directory uses old structure (needs upgrade)' }
  }
  
  // Need config to check for user-specific symlinks
  if (!config) {
    return { exists: true, isValid: false, message: 'thoughts directory exists but configuration is missing' }
  }
  
  // Check for expected symlinks in new structure
  const userPath = path.join(thoughtsDir, config.user)
  const sharedPath = path.join(thoughtsDir, 'shared')
  const globalPath = path.join(thoughtsDir, 'global')
  
  const hasUser = fs.existsSync(userPath) && fs.lstatSync(userPath).isSymbolicLink()
  const hasShared = fs.existsSync(sharedPath) && fs.lstatSync(sharedPath).isSymbolicLink()
  const hasGlobal = fs.existsSync(globalPath) && fs.lstatSync(globalPath).isSymbolicLink()
  
  if (!hasUser || !hasShared || !hasGlobal) {
    return { exists: true, isValid: false, message: 'thoughts directory exists but symlinks are missing or broken' }
  }
  
  return { exists: true, isValid: true }
}

async function selectFromList(message: string, options: string[]): Promise<number> {
  if (message) {
    console.log(chalk.cyan(message))
  }
  options.forEach((opt, idx) => {
    console.log(`  [${idx + 1}] ${opt}`)
  })
  
  while (true) {
    const answer = await prompt('Select option: ')
    const num = parseInt(answer)
    if (num >= 1 && num <= options.length) {
      return num - 1
    }
    console.log(chalk.red('Invalid selection. Please try again.'))
  }
}

function generateClaudeMd(thoughtsRepo: string, reposDir: string, repoName: string, user: string): string {
  const reposPath = path.join(thoughtsRepo, reposDir, repoName).replace(os.homedir(), '~')
  const globalPath = path.join(thoughtsRepo, 'global').replace(os.homedir(), '~')
  
  return `# Thoughts Directory Structure

This directory contains developer thoughts and notes for the ${repoName} repository.
It is managed by the HumanLayer thoughts system and should not be committed to the code repository.

## Structure

- \`${user}/\` → Your personal notes for this repository (symlink to ${reposPath}/${user})
- \`shared/\` → Team-shared notes for this repository (symlink to ${reposPath}/shared)
- \`global/\` → Cross-repository thoughts (symlink to ${globalPath})
  - \`${user}/\` - Your personal notes that apply across all repositories
  - \`shared/\` - Team-shared notes that apply across all repositories

## Usage

Create markdown files in these directories to document:
- Architecture decisions
- Design notes
- TODO items
- Investigation results
- Any other development thoughts

Quick access:
- \`thoughts/${user}/\` for your repo-specific notes (most common)
- \`thoughts/global/${user}/\` for your cross-repo notes

These files will be automatically synchronized with your thoughts repository when you commit code changes.

## Important

- Never commit the thoughts/ directory to your code repository
- The git pre-commit hook will prevent accidental commits
- Use \`humanlayer thoughts sync\` to manually sync changes
- Use \`humanlayer thoughts status\` to see sync status
`
}

function setupGitHooks(repoPath: string): void {
  const hooksDir = path.join(repoPath, '.git', 'hooks')
  
  // Pre-commit hook
  const preCommitPath = path.join(hooksDir, 'pre-commit')
  const preCommitContent = `#!/bin/bash
# HumanLayer thoughts protection - prevent committing thoughts directory

if git diff --cached --name-only | grep -q "^thoughts/"; then
    echo "❌ Cannot commit thoughts/ to code repository"
    echo "The thoughts directory should only exist in your separate thoughts repository."
    git reset HEAD -- thoughts/
    exit 1
fi

# Call any existing pre-commit hook
if [ -f "${preCommitPath}.old" ]; then
    "${preCommitPath}.old" "$@"
fi
`
  
  // Post-commit hook
  const postCommitPath = path.join(hooksDir, 'post-commit')
  const postCommitContent = `#!/bin/bash
# HumanLayer thoughts auto-sync

# Get the commit message
COMMIT_MSG=$(git log -1 --pretty=%B)

# Auto-sync thoughts after each commit
humanlayer thoughts sync --message "Auto-sync with commit: $COMMIT_MSG" >/dev/null 2>&1 &

# Call any existing post-commit hook
if [ -f "${postCommitPath}.old" ]; then
    "${postCommitPath}.old" "$@"
fi
`
  
  // Backup existing hooks if they exist
  if (fs.existsSync(preCommitPath) && !fs.readFileSync(preCommitPath, 'utf8').includes('HumanLayer thoughts')) {
    fs.renameSync(preCommitPath, `${preCommitPath}.old`)
  }
  
  if (fs.existsSync(postCommitPath) && !fs.readFileSync(postCommitPath, 'utf8').includes('HumanLayer thoughts')) {
    fs.renameSync(postCommitPath, `${postCommitPath}.old`)
  }
  
  // Write new hooks
  fs.writeFileSync(preCommitPath, preCommitContent)
  fs.writeFileSync(postCommitPath, postCommitContent)
  
  // Make hooks executable
  fs.chmodSync(preCommitPath, '755')
  fs.chmodSync(postCommitPath, '755')
}

export async function thoughtsInitCommand(options: InitOptions): Promise<void> {
  try {
    const currentRepo = getCurrentRepoPath()
    
    // Check if we're in a git repository
    try {
      execSync('git rev-parse --git-dir', { stdio: 'pipe' })
    } catch {
      console.error(chalk.red('Error: Not in a git repository'))
      process.exit(1)
    }
    
    // Load or create global config first
    let config = loadThoughtsConfig(options)
    let isNewConfig = false
    
    // If no config exists, we need to set it up first
    if (!config) {
      isNewConfig = true
      console.log(chalk.blue('=== Initial Thoughts Setup ==='))
      console.log('')
      console.log('First, let\'s configure your global thoughts system.')
      console.log('')
      
      // Get thoughts repository location
      const defaultRepo = getDefaultThoughtsRepo()
      console.log(chalk.gray('This is where all your thoughts across all projects will be stored.'))
      const thoughtsRepoInput = await prompt(`Thoughts repository location [${defaultRepo}]: `)
      const thoughtsRepo = thoughtsRepoInput || defaultRepo
      
      // Get directory names
      console.log('')
      console.log(chalk.gray('Your thoughts will be organized into two main directories:'))
      console.log(chalk.gray('- Repository-specific thoughts (one subdirectory per project)'))
      console.log(chalk.gray('- Global thoughts (shared across all projects)'))
      console.log('')
      
      const reposDirInput = await prompt(`Directory name for repository-specific thoughts [repos]: `)
      const reposDir = reposDirInput || 'repos'
      
      const globalDirInput = await prompt(`Directory name for global thoughts [global]: `)
      const globalDir = globalDirInput || 'global'
      
      // Get user name
      console.log('')
      const defaultUser = process.env.USER || 'user'
      let user = ''
      while (!user || user.toLowerCase() === 'global') {
        const userInput = await prompt(`Your username [${defaultUser}]: `)
        user = userInput || defaultUser
        if (user.toLowerCase() === 'global') {
          console.log(chalk.red('Username cannot be "global" as it\'s reserved for cross-project thoughts.'))
          user = ''
        }
      }
      
      config = {
        thoughtsRepo,
        reposDir,
        globalDir,
        user,
        repoMappings: {},
      }
      
      // Show what will be created
      console.log('')
      console.log(chalk.yellow('Creating thoughts structure:'))
      console.log(`  ${chalk.cyan(thoughtsRepo)}/`)
      console.log(`    ├── ${chalk.cyan(reposDir)}/     ${chalk.gray('(project-specific thoughts)')}`)
      console.log(`    └── ${chalk.cyan(globalDir)}/    ${chalk.gray('(cross-project thoughts)')}`)
      console.log('')
      
      // Ensure thoughts repo exists
      ensureThoughtsRepoExists(thoughtsRepo, reposDir, globalDir)
      
      // Save initial config
      saveThoughtsConfig(config, options)
      console.log(chalk.green('✅ Global thoughts configuration created'))
      console.log('')
    }
    
    // Now check for existing setup in current repo
    const setupStatus = checkExistingSetup(config)
    
    if (setupStatus.exists && !options.force) {
      if (setupStatus.isValid) {
        console.log(chalk.yellow('Thoughts directory already configured for this repository.'))
        const reconfigure = await prompt('Do you want to reconfigure? (y/N): ')
        if (reconfigure.toLowerCase() !== 'y') {
          console.log('Setup cancelled.')
          return
        }
      } else {
        console.log(chalk.yellow(`⚠️  ${setupStatus.message || 'Thoughts setup is incomplete'}`))
        
        if (setupStatus.isOldStructure) {
          console.log('')
          console.log(chalk.blue('The thoughts system has been upgraded to use a simpler structure:'))
          console.log(`  OLD: thoughts/local/${config.user}/`)
          console.log(`  NEW: thoughts/${config.user}/`)
          console.log('')
        }
        
        const fix = await prompt('Do you want to fix the setup? (Y/n): ')
        if (fix.toLowerCase() === 'n') {
          console.log('Setup cancelled.')
          return
        }
      }
    }
    
    // Ensure thoughts repo still exists (might have been deleted)
    const expandedRepo = expandPath(config.thoughtsRepo)
    if (!fs.existsSync(expandedRepo)) {
      console.log(chalk.red(`Error: Thoughts repository not found at ${config.thoughtsRepo}`))
      console.log(chalk.yellow('The thoughts repository may have been moved or deleted.'))
      const recreate = await prompt('Do you want to recreate it? (Y/n): ')
      if (recreate.toLowerCase() === 'n') {
        console.log('Please update your configuration or restore the thoughts repository.')
        process.exit(1)
      }
      ensureThoughtsRepoExists(config.thoughtsRepo, config.reposDir, config.globalDir)
    }
    
    // Map current repository
    const reposDir = path.join(expandedRepo, config.reposDir)
    
    // Ensure repos directory exists
    if (!fs.existsSync(reposDir)) {
      fs.mkdirSync(reposDir, { recursive: true })
    }
    
    // Get existing repo directories
    const existingRepos = fs.readdirSync(reposDir).filter(name => {
      const fullPath = path.join(reposDir, name)
      return fs.statSync(fullPath).isDirectory() && !name.startsWith('.')
    })
    
    // Check if current repo is already mapped
    let mappedName = config.repoMappings[currentRepo]
    
    if (!mappedName) {
      console.log(chalk.blue('=== Repository Setup ==='))
      console.log('')
      console.log(`Setting up thoughts for: ${chalk.cyan(currentRepo)}`)
      console.log('')
      console.log(chalk.gray(`This will create a subdirectory in ${config.thoughtsRepo}/${config.reposDir}/`))
      console.log(chalk.gray('to store thoughts specific to this repository.'))
      console.log('')
      
      if (existingRepos.length > 0) {
        console.log('Select or create a thoughts directory for this repository:')
        const options = [...existingRepos.map(repo => `Use existing: ${repo}`), '→ Create new directory']
        const selection = await selectFromList('', options)
        
        if (selection === options.length - 1) {
          // Create new
          const defaultName = getRepoNameFromPath(currentRepo)
          console.log('')
          console.log(chalk.gray(`This name will be used for the directory: ${config.thoughtsRepo}/${config.reposDir}/[name]`))
          const nameInput = await prompt(`Directory name for this project's thoughts [${defaultName}]: `)
          mappedName = nameInput || defaultName
          
          // Sanitize the name
          mappedName = mappedName.replace(/[^a-zA-Z0-9_-]/g, '_')
          console.log(chalk.green(`✓ Will create: ${config.thoughtsRepo}/${config.reposDir}/${mappedName}`))
        } else {
          mappedName = existingRepos[selection]
          console.log(chalk.green(`✓ Will use existing: ${config.thoughtsRepo}/${config.reposDir}/${mappedName}`))
        }
      } else {
        // No existing repos, just create new
        const defaultName = getRepoNameFromPath(currentRepo)
        console.log(chalk.gray(`This name will be used for the directory: ${config.thoughtsRepo}/${config.reposDir}/[name]`))
        const nameInput = await prompt(`Directory name for this project's thoughts [${defaultName}]: `)
        mappedName = nameInput || defaultName
        
        // Sanitize the name
        mappedName = mappedName.replace(/[^a-zA-Z0-9_-]/g, '_')
        console.log(chalk.green(`✓ Will create: ${config.thoughtsRepo}/${config.reposDir}/${mappedName}`))
      }
      
      console.log('')
      
      // Update config
      config.repoMappings[currentRepo] = mappedName
      saveThoughtsConfig(config, options)
    }
    
    // Create directory structure
    createThoughtsDirectoryStructure(config.thoughtsRepo, config.reposDir, config.globalDir, mappedName, config.user)
    
    // Create thoughts directory in current repo
    const thoughtsDir = path.join(currentRepo, 'thoughts')
    if (fs.existsSync(thoughtsDir)) {
      fs.rmSync(thoughtsDir, { recursive: true, force: true })
    }
    fs.mkdirSync(thoughtsDir)
    
    // Create symlinks - flipped structure for easier access
    const repoTarget = getRepoThoughtsPath(config.thoughtsRepo, config.reposDir, mappedName)
    const globalTarget = getGlobalThoughtsPath(config.thoughtsRepo, config.globalDir)
    
    // Direct symlinks to user and shared directories for repo-specific thoughts
    fs.symlinkSync(path.join(repoTarget, config.user), path.join(thoughtsDir, config.user), 'dir')
    fs.symlinkSync(path.join(repoTarget, 'shared'), path.join(thoughtsDir, 'shared'), 'dir')
    
    // Global directory as before
    fs.symlinkSync(globalTarget, path.join(thoughtsDir, 'global'), 'dir')
    
    // Check for other users and create symlinks
    const otherUsers = updateSymlinksForNewUsers(
      currentRepo,
      config.thoughtsRepo,
      config.reposDir,
      mappedName,
      config.user
    )
    
    if (otherUsers.length > 0) {
      console.log(chalk.green(`✓ Added symlinks for other users: ${otherUsers.join(', ')}`))
    }
    
    // Generate CLAUDE.md
    const claudeMd = generateClaudeMd(config.thoughtsRepo, config.reposDir, mappedName, config.user)
    fs.writeFileSync(path.join(thoughtsDir, 'CLAUDE.md'), claudeMd)
    
    // Setup git hooks
    setupGitHooks(currentRepo)
    
    // Add thoughts to .gitignore if not already there
    const gitignorePath = path.join(currentRepo, '.gitignore')
    let gitignoreContent = ''
    
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8')
    }
    
    if (!gitignoreContent.includes('/thoughts/') && !gitignoreContent.includes('thoughts/')) {
      gitignoreContent += '\n# HumanLayer thoughts directory (root level only)\n/thoughts/\n'
      fs.writeFileSync(gitignorePath, gitignoreContent)
      console.log(chalk.green('✅ Added /thoughts/ to .gitignore'))
    }
    
    console.log(chalk.green('✅ Thoughts setup complete!'))
    console.log('')
    console.log(chalk.blue('=== Summary ==='))
    console.log('')
    console.log('Repository structure created:')
    console.log(`  ${chalk.cyan(currentRepo)}/`)
    console.log(`    └── thoughts/`)
    console.log(`         ├── ${config.user}/     ${chalk.gray(`→ ${config.thoughtsRepo}/${config.reposDir}/${mappedName}/${config.user}/`)}`)
    console.log(`         ├── shared/      ${chalk.gray(`→ ${config.thoughtsRepo}/${config.reposDir}/${mappedName}/shared/`)}`)
    console.log(`         └── global/      ${chalk.gray(`→ ${config.thoughtsRepo}/${config.globalDir}/`)}`)
    console.log(`             ├── ${config.user}/     ${chalk.gray('(your cross-repo notes)')}`)
    console.log(`             └── shared/  ${chalk.gray('(team cross-repo notes)')}`)
    console.log('')
    console.log('Protection enabled:')
    console.log(`  ${chalk.green('✓')} Pre-commit hook: Prevents committing thoughts/`)
    console.log(`  ${chalk.green('✓')} Post-commit hook: Auto-syncs thoughts after commits`)
    console.log(`  ${chalk.green('✓')} Added to .gitignore`)
    console.log('')
    console.log('Next steps:')
    console.log(`  1. Create markdown files in ${chalk.cyan(`thoughts/${config.user}/`)} for your notes`)
    console.log(`  2. Your thoughts will sync automatically when you commit code`)
    console.log(`  3. Run ${chalk.cyan('humanlayer thoughts status')} to check sync status`)
    
  } catch (error) {
    console.error(chalk.red(`Error during thoughts init: ${error}`))
    process.exit(1)
  }
}