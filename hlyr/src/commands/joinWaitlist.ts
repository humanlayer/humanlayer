import chalk from 'chalk'

interface JoinWaitlistOptions {
  email: string
}

export async function joinWaitlistCommand(options: JoinWaitlistOptions): Promise<void> {
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(options.email)) {
    console.error(chalk.red('✗ Invalid email format'))
    process.exit(1)
  }

  console.log(`Joining waitlist with email: ${options.email}...`)

  try {
    const response = await fetch('https://www.humanlayer.dev/api/waitlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'humanlayer-cli',
      },
      body: JSON.stringify({ email: options.email }),
    })

    if (!response.ok) {
      // Try to parse error message from response
      let errorMessage = `${response.status} ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.message || errorData.error) {
          errorMessage = errorData.message || errorData.error
        }
      } catch {
        // Ignore JSON parse errors, use default message
      }

      throw new Error(errorMessage)
    }

    // Success!
    console.log(chalk.green('✓ Successfully joined the HumanLayer Code waitlist!'))
    console.log(`We'll contact you at ${options.email} when we're ready to onboard you.`)
    console.log()
    console.log(chalk.cyan('Next steps:'))
    console.log('  • Check your email for a confirmation')
    console.log('  • Check out https://humanlayer.dev')
    console.log('  • Join our Discord community: https://humanlayer.dev/discord')
  } catch (error) {
    console.error(chalk.red('✗ Failed to join waitlist'))
    if (error instanceof Error) {
      console.error(chalk.red(`Error: ${error.message}`))
    } else {
      console.error(chalk.red(`Error: ${error}`))
    }
    process.exit(1)
  }
}
