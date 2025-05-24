import chalk from 'chalk'
import readline from 'readline'
import { spawn } from 'child_process'
import { loadConfigFile, saveConfigFile, getDefaultConfigPath } from '../config.js'

interface LoginOptions {
  apiBase?: string
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
    const appUrl = process.env.HUMANLAYER_APP_URL || 'https://app.humanlayer.dev'
    const loginUrl = `${appUrl}/cli-login`

    console.log(chalk.blue('HumanLayer Login'))
    console.log(chalk.gray(`To get your API token, visit: ${loginUrl}`))
    console.log('')

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

    const configPath = getDefaultConfigPath()
    console.log(chalk.yellow(`Token will be written to: ${configPath}`))

    const proceed = await question('Continue? (y/N): ')
    if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
      console.log(chalk.gray('Login cancelled'))
      process.exit(0)
    }

    const existingConfig = loadConfigFile()
    const newConfig = {
      ...existingConfig,
      api_token: token.trim(),
      api_base_url: options.apiBase || 'https://api.humanlayer.dev',
    }

    saveConfigFile(newConfig)
    console.log(chalk.green('Login successful!'))
  } catch (error) {
    console.error(chalk.red(`Error during login: ${error}`))
    process.exit(1)
  } finally {
    rl.close()
  }
}
