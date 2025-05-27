import chalk from 'chalk'
import readline from 'readline'
import { spawn } from 'child_process'
import { loadConfigFile, saveConfigFile, getDefaultConfigPath, resolveFullConfig } from '../config.js'
import { getProject } from '../hlClient.js'

interface LoginOptions {
  apiBase?: string
  appBase?: string
  configFile?: string
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve)
    })
  }

  try {
    // Load existing config if config file flag is set
    const existingConfig = options.configFile ? loadConfigFile(options.configFile) : { channel: {} }

    const config = resolveFullConfig({ ...options, configFile: options.configFile })
    const appUrl = options.appBase || config.app_base_url
    const loginUrl = `${appUrl}/cli-login`

    console.log(chalk.blue('HumanLayer Login'))

    // Try to open the URL in the default browser
    const openBrowser = async (url: string) => {
      const platform = process.platform
      let command: string

      if (platform === 'darwin') {
        command = 'open'
      } else if (platform === 'win32') {
        command = 'start'
      } else {
        command = 'xdg-open'
      }

      try {
        spawn(command, [url], { detached: true, stdio: 'ignore' }).unref()
        console.log(chalk.green('Opening browser...'))
      } catch (error) {
        console.log(chalk.yellow(`Could not open browser automatically: ${error}`))
        console.log(chalk.gray(`To get your API token, visit: ${loginUrl}`))
      }
    }

    const browserPrompt = await question(
      'Press Enter to open in default browser or ESC to continue manually: ',
    )
    if (browserPrompt !== '\u001b') {
      // ESC key
      await openBrowser(loginUrl)
    }
    console.log('')

    const token = await question('Paste your API token: ')

    if (!token.trim()) {
      console.error(chalk.red('Error: No token provided'))
      process.exit(1)
    }

    const configPath = options.configFile || getDefaultConfigPath()
    console.log(chalk.yellow(`Token will be written to: ${configPath}`))

    const proceed = await question('Continue? (Y/n): ')
    if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
      console.log(chalk.gray('Login cancelled'))
      process.exit(0)
    }

    // Use API base URL from config resolution
    const apiBaseUrl = options.apiBase || config.api_base_url

    let project
    try {
      project = await getProject(apiBaseUrl, token.trim())
    } catch (error) {
      console.error(chalk.red(`Returned token was invalid: ${error}`))
      process.exit(1)
    }

    const newConfig = {
      ...existingConfig,
      api_key: token.trim(),
    }

    // Only save API base URL if explicitly provided via flag
    if (options.apiBase) {
      newConfig.api_base_url = options.apiBase
    }

    // Only save app base URL if explicitly provided via flag
    if (options.appBase) {
      newConfig.app_base_url = options.appBase
    }

    saveConfigFile(newConfig, options.configFile)
    console.log(chalk.green(`Login successful, using project ${chalk.bold(project.name)}`))
  } catch (error) {
    console.error(chalk.red(`Error during login: ${error}`))
    process.exit(1)
  } finally {
    rl.close()
  }
}
