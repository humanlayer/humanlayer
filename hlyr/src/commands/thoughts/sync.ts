import {Command, Flags} from '@oclif/core'
import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import Configstore from 'configstore'

export default class Sync extends Command {
  static description = 'Sync thoughts with a remote repository'

  static examples = ['<%= config.bin %> <%= command.id %>']

  static flags = {
    // flag with a value (-n, --name=VALUE)
    name: Flags.string({char: 'n', description: 'name to print'}),
    // flag with no value (-f, --force)
    force: Flags.boolean({char: 'f'}),
  }

  static args = [{name: 'file'}]

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(Sync)

    const name = flags.name ?? 'world'
    this.log(`hello ${name} from /Users/pbarbosa/dev/humanlayer/hlyr/src/commands/thoughts/sync.ts`)
    if (args.file && flags.force) {
      this.log(`you input --force and --file: ${args.file}`)
    }

    // Check if thoughts.dir is configured
    const thoughtsDir = this.getThoughtsDir()
    if (!thoughtsDir) {
      this.error('Thoughts directory not configured. Please run `hlyr config set thoughts.dir <path>`')
    }

    // Check if the directory exists
    if (!fs.existsSync(thoughtsDir)) {
      this.error(`Thoughts directory not found: ${thoughtsDir}`)
    }

    // Check if the directory is a git repository
    if (!fs.existsSync(`${thoughtsDir}/.git`)) {
      this.error(`Thoughts directory is not a git repository: ${thoughtsDir}`)
    }

    // Check if the repository has a remote
    // try {
    //   execSync(`git -C ${thoughtsDir} remote -v`, {stdio: 'ignore'})
    // } catch {
    //   this.error(`Thoughts directory has no remote: ${thoughtsDir}`)
    // }

    // Check if there are any uncommitted changes
    // try {
    //   execSync(`git -C ${thoughtsDir} diff-index --quiet HEAD --`, {stdio: 'ignore'})
    // } catch {
    //   this.warn('You have uncommitted changes. Please commit or stash them before syncing.')
    // }

    // Check if there are any untracked files
    // try {
    //   execSync(`git -C ${thoughtsDir} ls-files --others --exclude-standard --empty-directory |
    //     grep -q . && exit 1 || exit 0`, {stdio: 'ignore'})
    // } catch {
    //   this.warn('You have untracked files. Please add them to .gitignore or commit them before syncing.')
    // }

    // Check if there are any stashed changes
    // try {
    //   execSync(`git -C ${thoughtsDir} rev-parse --verify --quiet refs/stash >/dev/null`, {stdio: 'ignore'})
    //   this.warn('You have stashed changes. Please apply or drop them before syncing.')
    // } catch {
    //   // No stashed changes
    // }

    // Check if the repository is ahead of the remote
    // try {
    //   execSync(`git -C ${thoughtsDir} rev-list --count --left-right @{u}...HEAD |
    //     grep -q -E '^[0-9]+[[:space:]]+0$' && exit 1 || exit 0`, {stdio: 'ignore'})
    // } catch {
    //   this.warn('You have unpushed commits. Please push them before syncing.')
    // }

    // Pull the latest changes from the remote repository
    if (thoughtsDir) {
      const gitPull = spawn('git', ['pull'], {cwd: thoughtsDir})

      let stdout = ''
      let stderr = ''

      gitPull.stdout.on('data', data => {
        stdout += data.toString()
      })

      gitPull.stderr.on('data', data => {
        stderr += data.toString()
      })

      gitPull.on('close', code => {
        if (code !== 0) {
          this.error(`Error pulling thoughts: git process exited with code ${code}\n${stderr}`)
        } else {
          if (stderr) {
            // Git can output to stderr on success (e.g., for progress)
            this.log(`Git stderr: ${stderr}`)
          }

          this.log(stdout)
          this.log('✨ Thoughts synced successfully.')
        }
      })

      gitPull.on('error', error => {
        // This catches errors like 'git' command not found
        this.error(`Error pulling thoughts: ${error.message}`)
      })
    }
  }

  private getThoughtsDir(): string | undefined {
    const config = new Configstore(this.config.pjson.name)
    return config.get('thoughts.dir')
  }
}
