import chalk from 'chalk'
import { resolveFullConfig } from '../config.js'
import { getProject } from '../hlClient.js'

export async function pingCommand(): Promise<void> {
  try {
    const config = resolveFullConfig({})

    if (!config.api_key) {
      console.error(chalk.red('Error: No HumanLayer API token found.'))
      console.error(chalk.gray('Run "humanlayer login" to authenticate.'))
      process.exit(1)
    }

    console.log(chalk.blue('Checking authentication...'))

    const project = await getProject(config.api_base_url, config.api_key)

    console.log(chalk.green('✓ Authentication successful'))
    console.log(chalk.blue(`Project: ${chalk.bold(project.name)}`))
    console.log(chalk.gray(`Organization: ${project.organization}`))
    console.log(chalk.gray(`API Base: ${config.api_base_url}`))
  } catch (error) {
    console.error(chalk.red('✗ Authentication failed'))
    console.error(chalk.red(`Error: ${error}`))
    console.error(chalk.gray('Run "humanlayer login" to re-authenticate.'))
    process.exit(1)
  }
}
